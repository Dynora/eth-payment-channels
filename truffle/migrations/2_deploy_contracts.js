var PaymentChannels = artifacts.require('./PaymentChannels.sol');


module.exports = function(deployer) {
  deployer.deploy(PaymentChannels);
};
