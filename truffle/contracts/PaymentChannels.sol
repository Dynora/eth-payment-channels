pragma solidity ^0.4.18;

contract PaymentChannels {

    struct PaymentChannel {
        address from;
        address to;
        uint deposit;
        uint timeout;
    }

    mapping (bytes32 => PaymentChannel) channels;
    mapping (address => mapping(address => bytes32)) active_channel_ids;


    function createChannel(address to, uint duration) public payable returns (bytes32) {
        if (msg.value == 0) { revert(); }
        if (to == msg.sender) { revert(); }
        if (active_channel_ids[msg.sender][to] != bytes32(0)) { revert(); }
        // The merchant should have reasonable time to settle the channel
        if (duration < 3600) { revert(); }

        // Generate channel id
        uint channel_timeout = now + duration;

        bytes32 channel_id = keccak256(msg.sender, to, channel_timeout);

        PaymentChannel memory channel;

        channel.from = msg.sender;
        channel.to = to;
        channel.deposit = msg.value;
        channel.timeout = channel_timeout;

        channels[channel_id] = channel;
        active_channel_ids[msg.sender][to] = channel_id;

        return channel_id;
    }

    function settleChannel(bytes32 channel_id, uint value, bytes signature) public {
        PaymentChannel memory _channel = channels[channel_id];

        // Check if channel is not already timed out
        //if (now > _channel.timeout) { revert(); }
        // Only merchant is allowed to settle channel
        if (msg.sender != _channel.to) { revert(); }
        // Value cannot be higher than deposit
        if (value > _channel.deposit) { revert(); }
        // Check if signature matches customer address
        if (_channel.from != getApprovedAmountAddress(channel_id, value, signature)) { revert(); }

        if (_channel.deposit > 0 && value > 0) {
            // Send agreed amount to merchant
            if (!_channel.to.send(value)) { revert(); }
            // Send remainder to customer
            if (!_channel.from.send(_channel.deposit - value)) { revert();}

            // Delete channel
            delete channels[channel_id];
            delete active_channel_ids[_channel.from][_channel.to];
        }
    }

    // As a way to prevent the merchant from forever blocking the funds in the
    // channel, create a timeout that will refund the funds to the payer,
    // encouraging to merchant to settle the channel
    function timeoutChannel(bytes32 channel_id) public {
        PaymentChannel memory _channel = channels[channel_id];

        if (now > _channel.timeout) {
            //Refund payer
            if (!_channel.from.send(_channel.deposit)) { revert(); }

            // Delete channel
            delete channels[channel_id];
            delete active_channel_ids[_channel.from][_channel.to];
        }
    }

    function getChannelId(address from, address to) public constant returns (bytes32) {
        return active_channel_ids[from][to];
    }

    function getChannelDeposit(bytes32 id) public constant returns (uint) {
        return channels[id].deposit;
    }

    function getChannelTimeout(bytes32 id) public constant returns (uint) {
        return channels[id].timeout;
    }

    function getChannelFrom(bytes32 id) public constant returns (address) {
        return channels[id].from;
    }

    function getChannelTo(bytes32 id) public constant returns (address) {
        return channels[id].to;
    }

    function getApprovedAmountAddress(bytes32 channel_id, uint value, bytes signature) public pure returns (address) {

        bytes32 hash = keccak256(
            keccak256(
                'string description',
                'bytes32 channel_id',
                'uint value'
            ),
            keccak256(
                'Approved amount signature',
                channel_id,
                value
            )
        );
        address checked_sender = ecverify(hash, signature);
        return checked_sender;
    }

    function ecverify(bytes32 hash, bytes signature) internal pure returns (address signature_address) {
        require(signature.length == 65);

        bytes32 r;
        bytes32 s;
        uint8 v;

        // The signature format is a compact form of:
        //   {bytes32 r}{bytes32 s}{uint8 v}
        // Compact means, uint8 is not padded to 32 bytes.
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))

            // Here we are loading the last 32 bytes, including 31 bytes of 's'.
            v := byte(0, mload(add(signature, 96)))
        }

        // Version of signature should be 27 or 28, but 0 and 1 are also possible
        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28);

        signature_address = ecrecover(hash, v, r, s);

        // ecrecover returns zero on error
        require(signature_address != 0x0);

        return signature_address;
    }
}