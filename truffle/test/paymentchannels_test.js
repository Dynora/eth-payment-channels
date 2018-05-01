// Specifically request an abstraction for MetaCoin
var PaymentChannels = artifacts.require("./PaymentChannels.sol");

contract('PaymentChannels', function(accounts) {
  it("should create a channel", function() {
      var contract_instance;
      var channelId;

    return PaymentChannels.deployed().then(function(instance) {
        contract_instance = instance;
      return contract_instance.createChannel(accounts[1], 3600, {from: accounts[0], value: 10});
    }).then(function() {
        return contract_instance.getChannelId.call(accounts[0], accounts[1]);
    }).then(function(id) {
        channelId = id;
        assert.notEqual(channelId.valueOf(), 0, "a channel is created");
        return contract_instance.getChannelDeposit.call(channelId);
    }).then(function(deposit) {
        assert.equal(deposit.valueOf(), 10, "deposit matches");
        return contract_instance.getChannelDeposit.call(channelId);
    });
  });

});