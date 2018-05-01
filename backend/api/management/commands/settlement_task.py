from datetime import datetime, timedelta
import pytz
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from api.models import PaymentChannel
from api.utils import get_web3_object, get_contract_object, send_signed_transaction


class Command(BaseCommand):
    help = 'Task for settle almost timed out payment channels'

    def add_arguments(self, parser):
        parser.add_argument(
            '--test',
            action='store_true',
            dest='test',
            help='Dry run of settlements',
        )

    def handle(self, *args, **options):

        web3 = get_web3_object()
        contract = get_contract_object(web3, 'PaymentChannels')

        threshold_datetime = datetime.now(pytz.utc) + timedelta(seconds=600)
        self.stdout.write("==========================================================================")
        self.stdout.write("Checking for channels expiring before {}".format(threshold_datetime.strftime('%d-%m-%Y %H:%M')))
        self.stdout.write("==========================================================================")

        pending_channels = PaymentChannel.objects.filter(
            is_settled=False,
            is_timed_out=False,
            is_failed=False,
            timeout__lt=threshold_datetime)

        for channel in pending_channels:
            self.stdout.write('Settling channel {}...'.format(channel.channel_id))

            timeout = contract.functions.getChannelTimeout(channel.channel_id).call()

            if timeout == 0 or datetime.now(pytz.utc) > channel.timeout:
                self.stdout.write(self.style.ERROR('Channel timeouts - lost deposit'))
                channel.is_timed_out = True
                channel.save()
            else:
                # Try to settle
                address = contract.functions.getApprovedAmountAddress(
                    channel.channel_id,
                    channel.committed_amount,
                    channel.signature
                ).call()

                if address != channel.from_address:
                    self.stdout.write(self.style.ERROR('Signature validation failed'))
                    channel.is_failed = True
                    channel.save()
                else:
                    try:
                        tx_info = contract.functions.settleChannel(
                            channel.channel_id,
                            channel.committed_amount,
                            channel.signature
                        ).buildTransaction(
                            {'from': settings.ETH_MERCHANT_ADDRESS}
                        )

                        tx_hash = send_signed_transaction(web3, tx_info)

                        # Save state
                        channel.is_settled = True
                        channel.save()

                        self.stdout.write(self.style.SUCCESS('Successfully settled channel, tx: {}'.format(web3.toHex(tx_hash))))
                    except ValueError as e:

                        channel.is_failed = True
                        channel.save()

                        self.stdout.write(self.style.ERROR('Transaction failed: {}'.format(e)))
