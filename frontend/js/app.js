App = {
  web3Provider: null,
  contracts: {},

  channelInfo: {
      channelId: null,
      merchantAddress: null,
      deposit: null,
      amount: 0,
      signature: null
  },

  init: function() {
    if (localStorage.getItem("channelInfo")) {
        App.channelInfo = JSON.parse(localStorage.getItem("channelInfo"));
    }
    return App.initWeb3();
  },

  initWeb3: function() {
    if (typeof web3 !== 'undefined') {
      App.web3Provider = web3.currentProvider;
    } else {
      // If no injected web3 instance is detected, fall back to Ganache
      App.web3Provider = new Web3.providers.HttpProvider('http://localhost:7545');
      alert('fall back to Ganache')
    }
    web3 = new Web3(App.web3Provider);

    return App.initContract();
  },

  initContract: function() {
    $.getJSON('PaymentChannels.json', function(data) {
        // Get the necessary contract artifact file and instantiate it with truffle-contract
        App.contracts.PaymentChannels = TruffleContract(data);

        // Set the provider our contract
        App.contracts.PaymentChannels.setProvider(App.web3Provider);

    });

    return App.checkActions();
  },
  checkActions: function() {

    var queryString = document.location.search.substring(1);
    if (queryString != "") {
        var queryObject = JSON.parse('{"' + decodeURI(queryString).replace(/"/g, '\\"').replace(/&/g, '","').replace(/=/g, '":"') + '"}');

        if (queryObject.action == 'checkSignature') {

            if (App.checkApprovedAmount(queryObject.channel_id, queryObject.amount, queryObject.signature, queryObject.sender)) {
                var settleChannel = confirm('Verified signature for ' + web3.fromWei(queryObject.amount, 'ether') + ' ether. Settle channel now?');
                if (settleChannel) {
                    App.settleChannel(queryObject.channel_id, queryObject.amount, queryObject.signature, function(result) {
                       alert('Settlement initiated');
                    });
                }
            } else {
                alert('Verification failed');
            }
        }
    }
    return App.bindEvents();
  },
  bindEvents: function() {
    $(document).on('click', '#create-channel-btn', App.createChannelEvent);
    $(document).on('click', '#get-paid-content-btn', App.paidContentEvent);
    $(document).on('click', '#timeout-channel-btn', App.timeoutChannelEvent);
    $(document).on('click', '#settle-channel-btn', App.settleChannelEvent);
    $(document).on('click', '#create-qrcode-btn', App.createReleaseQRCodeEvent);
  },
  // ===========================================================================
  createChannel: function(to, deposit, timeout, callback) {
    web3.eth.getAccounts(function(error, accounts) {
        if (error) {
            console.log(error);
        }
        var account = accounts[0];

        App.contracts.PaymentChannels.deployed().then(function(instance) {

            return instance.createChannel(web3.toHex(to), timeout, {from: account, value: web3.toWei(deposit)})

        }).then(function(result) {

            console.log('create channel result:', result);
            return callback();

        }).catch(function(err) {

            console.log(err.message);

        });
    });
  },
  paidContentEvent: function(event) {
        event.preventDefault();

        var url = "http://127.0.0.1:8000/channel/initiate/";

        App.getPaidContent(url, function(json) {
            $('#content-output').html(json.data)
        })

  },
  getPaidContent: function(url, callback) {

       web3.eth.getAccounts(function(error, accounts) {
           if (error) {
               console.log(error);
           }


           var account = accounts[0];

           // check if account is active
           if (!accounts[0]) {
               alert('Please unlock Metamask');
               return;
           }

           var request = null;

           // Check for channel
           if (true || !App.channelInfo.merchantAddress) {
               // Retrieve merchant address

               if (App.channelInfo.signature && App.channelInfo.channelId && App.channelInfo.amount) {

                  // POST signature to API
                  request = $.ajax({
                       url: url,
                       method: 'POST',
                       data: {
                          channel_id: App.channelInfo.channelId,
                          amount: App.channelInfo.amount,
                          signature: App.channelInfo.signature
                      }
                  });
               } else {
                   request = $.ajax({
                       url: url + '?sender=' + account,
                       method: 'GET'
                   });
               }

               $('body').showLoading();

               request.done(function (json) {
                   $('body').hideLoading();
                   App.channelInfo.merchantAddress = json.address;
                   App.channelInfo.channelId = json.channel_id;
                   callback(json);
               });

               request.fail(function (jqXHR) {

                   if (jqXHR.status == 402) {
                       console.log('Payment required');
                       var result = jqXHR.responseJSON;

                       console.log('Store merchant address', result.address);
                       App.channelInfo.merchantAddress = result.address;

                       // Retrieve channelId
                       App.contracts.PaymentChannels.deployed().then(function (instance) {

                           return instance.getChannelId.call(web3.toHex(account), web3.toHex(App.channelInfo.merchantAddress));

                       }).then(function (channelId) {

                           console.log('check for Channel ID:', channelId);

                           if (channelId && channelId != '0x0000000000000000000000000000000000000000000000000000000000000000') {
                               App.channelInfo.channelId = channelId;

                               App.contracts.PaymentChannels.deployed().then(function (instance) {

                                   return instance.getChannelTimeout.call(channelId);

                               }).then(function (timeout) {

                                   console.log('channel timeout', timeout.toNumber());

                                   // Check if channel has expired
                                   if (parseInt(new Date().getTime() / 1000) > timeout.toNumber()) {
                                       if (confirm('Channel has expired, claim deposit back?')) {
                                           App.timeoutChannel(App.channelInfo.merchantAddress, function () {
                                               alert('Deposit has been sent back to account ' + account);
                                           });
                                       }
                                       $('body').hideLoading();
                                       return;
                                   }

                                   App.contracts.PaymentChannels.deployed().then(function (instance) {

                                       return instance.getChannelDeposit.call(channelId);

                                   }).then(function (depositAmount) {

                                       console.log('deposit:', depositAmount.toNumber());

                                       //store locally
                                       App.channelInfo.deposit = depositAmount.toNumber();

                                       result.channel_id = channelId;
                                       result.deposit_amount = depositAmount.toNumber();
                                       //result.committed_amount = result.committed_amount;
                                       // TODO Try to re-use last message and signature
                                       App.approveAmount(account, url, result, function (json) {
                                           $('body').hideLoading();
                                           callback(json);
                                       });
                                   });
                               });
                           } else {

                               if (account.toLowerCase() == App.channelInfo.merchantAddress.toLowerCase()) {
                                   alert('You cannot open a channel to yourself');
                                   $('body').hideLoading();
                                   return;
                               }
                               console.log('No channel found, initiate new channel');
                               var deposit = prompt("How much ether as deposit?", 0.1);
                               if (deposit > 0) {
                                   App.createChannel(App.channelInfo.merchantAddress, deposit, 3600, function () {
                                       console.log('Channel created to ', App.channelInfo.merchantAddress);

                                       // Retrieve channelId
                                       App.contracts.PaymentChannels.deployed().then(function (instance) {

                                           return instance.getChannelId.call(web3.toHex(account), web3.toHex(App.channelInfo.merchantAddress));

                                       }).then(function (channelId) {

                                           console.log('found Channel ID:', channelId);

                                           App.channelInfo.channelId = channelId;
                                           App.channelInfo.deposit = web3.toWei(deposit);

                                           App.approveAmount(account, url, result, function (json) {
                                               $('body').hideLoading();
                                               callback(json);
                                           });

                                       }).catch(function (err) {
                                           $('body').hideLoading();
                                           console.log(err.message);

                                       });

                                   });
                               } else {
                                   $('body').hideLoading();
                                   return;
                               }
                           }
                       }).catch(function (err) {
                           $('body').hideLoading();
                           console.log(err.message);

                       });
                   } else if (jqXHR.status == 404) {
                       // Channel expired or settled: reset local data
                       App.channelInfo.channelId = null;
                       App.channelInfo.deposit = null;
                       App.channelInfo.amount = 0;
                       App.channelInfo.signature = null;
                       $('body').hideLoading();
                       alert('Channel expired or already settled');
                    } else if (jqXHR.status == 403) {
                       $('body').hideLoading();
                       alert('Error: ' + jqXHR.responseText);
                   } else {
                       $('body').hideLoading();
                       alert('Error with payment request');
                   }
               });
           }

       });
  },
  approveAmount: function(account, approveUrl, result, callback) {
    console.log(result);
    if (result.committed_amount) {
        App.channelInfo.amount = result.committed_amount;
    }
    console.log('result', result);
    console.log('Sign new approved amount and post signature to API');
    var approveAmount = prompt("Cost for single request is " + web3.fromWei(result.cost, 'ether') + ' ether. \n\n' +
        'Total approved amount: ' + web3.fromWei(App.channelInfo.amount) +' ether.\n\n' +
        'Remainder of deposit is: ' + web3.fromWei(App.channelInfo.deposit - result.used_amount) +' ether.\n\n' +
        'Which amount you want to approve?', web3.fromWei(parseInt(App.channelInfo.amount) + result.cost, 'ether'));

    if (approveAmount > 0) {

      // Sign message
      console.log('Sign approval of ' + approveAmount + ' ether');

      var messageData = [
          {
              'type': 'string',
              'name': 'description',
              'value': 'Approved amount signature'
          },
          {
              'type': 'bytes32',
              'name': 'channel_id',
              'value': App.channelInfo.channelId
          },
          {
              'type': 'uint',
              'name': 'value',
              'value': web3.toWei(approveAmount)
          }
      ];

      App.signTypedData(messageData, function (signature) {
          console.log('signature', signature);

          // Store message and signature
          App.channelInfo.amount = web3.toWei(approveAmount);
          App.channelInfo.signature = signature;

          // POST signature to API
          var data = {
              channel_id: App.channelInfo.channelId,
              amount: web3.toWei(approveAmount),
              signature: signature
          };

          var sign_request = $.ajax({
               url: approveUrl,
               method: 'POST',
               data: data
          });

          sign_request.done(function(json) {
              // store channelinfo in localstorage
              localStorage.setItem("channelInfo",JSON.stringify(App.channelInfo));
              // process callback
              callback(json);
          });

          sign_request.fail(function(jqXHR) {
              if (jqXHR.status == 402) {
                  var result = jqXHR.responseJSON;
                  console.log('Another payment required');
                  App.approveAmount(account, approveUrl, result, callback);
              }
              else if (jqXHR.status == 404) {
                  alert('Invalid channel');
              }
          });
      });
    }
  },
  signTypedData: function(data, callback) {

      console.log('data to sign', data);

      web3.eth.getAccounts(function(error, accounts) {
          if (error) {
              console.log(error);
          }
          var account = accounts[0];

          web3.currentProvider.sendAsync({
              method: 'eth_signTypedData',
              params: [data, account]
          }, function (err, result) {

              var sig = result.result;

              return callback(sig);

          });
      });
  },
  checkApprovedAmount: function(channelId, amount, signature, sender) {
      var messageData = [
          {
              'type': 'string',
              'name': 'description',
              'value': 'Approved amount signature'
          },
          {
              'type': 'bytes32',
              'name': 'channel_id',
              'value': channelId
          },
          {
              'type': 'uint',
              'name': 'value',
              'value': amount
          }
      ];

      var recovered = ethSigUtil.recoverTypedSignature({
             data: messageData,
             sig: signature
          });

      return recovered == sender;

  },
  timeoutChannelEvent: function(event) {
      event.preventDefault();

      App.timeoutChannel(App.channelInfo.merchantAddress, function() {
        alert('Channel timeout succesful initiated');
      });
  },
  timeoutChannel: function(channelTo, callback) {
      web3.eth.getAccounts(function(error, accounts) {
        if (error) {
            console.log(error);
        }
        var account = accounts[0];

        // Retrieve channelId
       App.contracts.PaymentChannels.deployed().then(function (instance) {
            console.log('search channel between', account, channelTo);
           return instance.getChannelId.call(web3.toHex(account), web3.toHex(channelTo));

       }).then(function (channelId) {


           if (channelId && channelId != '0x0000000000000000000000000000000000000000000000000000000000000000') {

               App.contracts.PaymentChannels.deployed().then(function (instance) {

                   return instance.timeoutChannel(channelId, {from: account});

               }).then(function (result) {

                   console.log('create channel result:', result);
                   return callback();

               }).catch(function (err) {

                   console.log(err.message);

               });
           } else {
               alert('Cannot claim deposit back, channel not found')
           }
         });
      });
  },
  settleChannelEvent: function(event) {
      event.preventDefault();

      App.settleChannel(App.channelInfo.channelId, App.channelInfo.amount, App.channelInfo.signature, function(result) {

        // Channel settled: reset local data
        App.channelInfo.channelId = null;
        App.channelInfo.deposit = null;
        App.channelInfo.amount = 0;
        App.channelInfo.signature = null;
        $('#content-output').html(result);
        alert('Settlement succesfully initiated');
      });
  },
  settleChannel: function(channelId, amount, signature, callback) {
      // Only merchant is allowed to do settlement, so send request to API
      // POST signature to API
      var request = $.ajax({
           url: 'http://127.0.0.1:8000/channel/settle/',
           method: 'POST',
           data: {
              channel_id: channelId,
              amount: amount,
              signature: signature
          }
      });

      request.done(function (json) {
          callback(json);
       });

       request.fail(function (jqXHR) {
           if (jqXHR.status == 404) {
               alert('Channel not found');
           } else if (jqXHR.status == 403) {
               alert('Error: ' + jqXHR.responseText);
           } else {
               alert('Error with settlement');
           }

       });

  },
  createChannelEvent: function(event) {
    event.preventDefault();

    var channelTo = $("#create-channel-to").val();

    console.log('Create channel to ', channelTo);

    App.createChannel(channelTo, 0.1, 1000, function() {
        console.log('Channel created to ', channelTo);
    });
  },
  createReleaseQRCodeEvent: function(event) {
        event.preventDefault();
        web3.eth.getAccounts(function(error, accounts) {
            if (error) {
                console.log(error);
            }
            var account = accounts[0];



            if (App.channelInfo.channelId) {

                var approveAmount = prompt('Which amount you want to approve?', web3.fromWei(App.channelInfo.deposit || 0, 'ether'));

                if (approveAmount > 0) {

                    var messageData = [
                        {
                            'type': 'string',
                            'name': 'description',
                            'value': 'Approved amount signature'
                        },
                        {
                            'type': 'bytes32',
                            'name': 'channel_id',
                            'value': App.channelInfo.channelId
                        },
                        {
                            'type': 'uint',
                            'name': 'value',
                            'value': web3.toWei(approveAmount)
                        }
                    ];

                    App.signTypedData(messageData, function (signature) {

                        var qrUrl = 'http://' + location.host + '/?action=checkSignature&channel_id=' + App.channelInfo.channelId +
                            '&amount=' + web3.toWei(approveAmount) + '&signature=' + signature + '&sender=' + account;

                        App.channelInfo.amount = web3.toWei(approveAmount);
                        App.channelInfo.signature = signature;

                        console.log(qrUrl);

                        $("#content-output").html('').qrcode({text: qrUrl});
                    });
                }
            } else {
                alert('No channel known');
            }
        });
    }
};

$(function() {
  $(window).load(function() {
    App.init();
  });
});
