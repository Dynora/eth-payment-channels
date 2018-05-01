import pytz
from datetime import datetime
from django.shortcuts import render

# Create your views here.
from django.http import Http404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from web3 import Web3
from django.conf import settings

from api.models import PaymentChannel
from api.utils import get_web3_object, get_contract_object, send_signed_transaction


class PaymentChannelView(APIView):
    """
    Base for handling views using Ethereum payment channels
    """
    wei_per_request = None

    def get_request_data(self, channel):
        raise NotImplementedError("View has not implemented this method")

    def _process_channel(self, channel):
        # Check timeout
        if datetime.now(pytz.utc) > channel.timeout:
            return Response({
                'channel_id': None,
                'address': settings.ETH_MERCHANT_ADDRESS,
                'amount_needed': self.wei_per_request,
                'cost': self.wei_per_request,
                'deposit_amount': 0,
                'committed_amount': 0,
                'used_amount': 0
            }, status=status.HTTP_402_PAYMENT_REQUIRED)

        # Check remaining deposit
        amount_needed = max(0, self.wei_per_request + channel.used_amount - channel.committed_amount)

        if amount_needed > 0:

            return Response(
                {
                    'channel_id': channel.channel_id,
                    'address': settings.ETH_MERCHANT_ADDRESS,
                    'cost': self.wei_per_request,
                    'deposit_amount': channel.deposit_amount,
                    'committed_amount': channel.committed_amount,
                    'used_amount': channel.used_amount,
                    'amount_needed': max(0, self.wei_per_request + channel.used_amount - channel.committed_amount),
                }, status=status.HTTP_402_PAYMENT_REQUIRED)

        else:
            # Process request
            channel.used_amount += self.wei_per_request
            channel.save()

            #page = requests.get('https://nl.wikipedia.org/wiki/Ethereum')

            return Response(
                {
                    "data": self.get_request_data(channel),
                    'channel_id': channel.channel_id,
                    'address': settings.ETH_MERCHANT_ADDRESS,
                    'cost': self.wei_per_request,
                    "used_amount": channel.used_amount,
                    "committed_amount": channel.committed_amount,
                    'deposit_amount': channel.deposit_amount
                })

    def get(self, request, format=None):

        return Response(
            {
                'channel_id': None,
                'address': settings.ETH_MERCHANT_ADDRESS,
                'cost': self.wei_per_request,
                'amount_needed': self.wei_per_request
            }, status=status.HTTP_402_PAYMENT_REQUIRED
        )

    def post(self, request, format=None):
        channel_id = request.data.get('channel_id')
        amount = request.data.get('amount')
        signature = request.data.get('signature')

        if self.wei_per_request is None:
            raise ValueError("Cost must be specified")

        if not channel_id or not amount or not signature:
            return Response("Missing parameters", status=status.HTTP_400_BAD_REQUEST)

        web3 = get_web3_object()
        contract = get_contract_object(web3, 'PaymentChannels')

        address = contract.functions.getApprovedAmountAddress(channel_id, Web3.toInt(text=amount), signature).call()

        # Try to fetch from geth
        orig_channel_id = contract.functions.getChannelId(address, settings.ETH_MERCHANT_ADDRESS).call()

        channel_id = Web3.toHex(orig_channel_id)

        if channel_id == settings.ETH_EMPTY_ADDRESS:
            return Response({
                'channel_id': None,
                'address': settings.ETH_MERCHANT_ADDRESS,
                'amount_needed': self.wei_per_request,
                'cost': self.wei_per_request,
                'deposit_amount': 0,
                'committed_amount': 0,
                'used_amount': 0
            }, status=status.HTTP_404_NOT_FOUND)
        else:

            # Retrieve channel object
            try:
                channel = PaymentChannel.objects.get(channel_id=channel_id)

                # Check if address is sender of channel
                if channel.from_address != address:
                    return Response(
                        "Sender {} does not match channel from address {} ".format(address, channel.from_address),
                        status=status.HTTP_403_FORBIDDEN)

                # Check if address is already settled
                if channel.is_settled:
                    return Response(
                        "Channel is already being settled",
                        status=status.HTTP_403_FORBIDDEN)

            except PaymentChannel.DoesNotExist:

                # Create new channel object
                deposit_amount = contract.functions.getChannelDeposit(orig_channel_id).call()
                timeout = contract.functions.getChannelTimeout(orig_channel_id).call()

                # Check channel in database
                channel = PaymentChannel.objects.create(
                    channel_id=channel_id,
                    from_address=address,
                    deposit_amount=deposit_amount,
                    timeout=datetime.fromtimestamp(timeout, tz=pytz.UTC),
                    committed_amount=0,
                    used_amount=0
                )

            # Top up account

            approved_amount = min(int(amount), channel.deposit_amount)

            if approved_amount > channel.committed_amount:
                # Only save signature if approved amount is higher
                channel.committed_amount = min(int(amount), channel.deposit_amount)
                channel.signature = signature
                channel.save()

            if approved_amount == channel.deposit_amount:
                # TODO Flag for Settlement
                pass

            # Process channel
            return self._process_channel(channel)


class PaymentChannelExampleView(PaymentChannelView):

    wei_per_request = 1000000000000000

    def get_request_data(self, channel):
        return "Paid content generated for {} at {}".format(
            channel.from_address,
            datetime.now()
        )


class SettlePaymentChannelView(APIView):

    def post(self, request, format=None):
        channel_id = request.data.get('channel_id')
        amount = int(request.data.get('amount'))
        signature = request.data.get('signature')

        web3 = get_web3_object()

        # Customer want to settle, or merchant needs to settle because timeout is near

        # Check if signed amount corresponds with administration.
        try:
            channel = PaymentChannel.objects.get(channel_id=channel_id, is_settled=False)

            if channel.used_amount > amount:
                return Response(
                    "Not allowed to settle channel for less than owed amount of {}".format(channel.used_amount),
                    status=status.HTTP_403_FORBIDDEN
                )

            if amount > channel.deposit_amount:
                return Response(
                    "Deposit is less than provided amount",
                    status=status.HTTP_403_FORBIDDEN
                )

            contract = get_contract_object(web3, 'PaymentChannels')

            address = contract.functions.getApprovedAmountAddress(channel_id, amount, signature).call()

            if address != channel.from_address:
                return Response(
                    "Incorrect signature provided",
                    status=status.HTTP_400_BAD_REQUEST
                )
            try:
                tx_info = contract.functions.settleChannel(channel_id, amount, signature).buildTransaction(
                    {'from': settings.ETH_MERCHANT_ADDRESS}
                )

                tx_hash = send_signed_transaction(web3, tx_info)

                # Save state
                channel.is_settled = True
                channel.save()

                return Response({'result': 'Settlement initiated', 'tx_hash': web3.toHex(tx_hash)})
            except ValueError as e:
                return Response({'result': 'Could not initiate settlement'}, status=status.HTTP_400_BAD_REQUEST)

        except PaymentChannel.DoesNotExist:
            raise Http404

