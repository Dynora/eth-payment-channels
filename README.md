# eth-payment-channels

Ethereum off-chain payments channels for use with Django REST API projects.

The project contains three parts; the smart contract is managed by
Truffle (http://truffleframework.com/), the backend is Django
which plays the role of merchant and takes care of the off chain
administration and settlement of channels. The frontend is just plain
Javascript (for now)


## Installation

### Truffle

- Install Truffle: `npm install -g truffle`
- In de `./truffle` folder install dependencies: `npm install`
- Compile the smart contract: `truffle compile`
- Enter a BIP39 mnemonic (for example the one you will create with MetaMask later) in `truffle/truffle.js`
- Deploy the smart contract to the network of your choice: `truffle migrate --network rinkeby`

### Backend

- In `./backend` folder and in a Python 3 virtualenv install requirements: `pip install -r requirements.txt`
- In `./backend/paymentchannels` folder create a `local_settings.py` file to overwrite at least:
  - ETH_MERCHANT_ADDRESS
  - ETH_MERCHANT_PRIVATE_KEY
  - ETH_CONTRACT_ADDRESS
  - ETH_CURRENT_NETWORK (depending on which network you are currently working on)

- Create the tables: `./manage.py migrate`
- Start Django dev server: `./manage.py runserver`

## Frontend
- Install the MetaMask extension for Chrome
- in `./truffle` folder, run a dev web server to host the
frontend: `npm run dev`


## Periodic tasks

Put `./manage.py settlement_task` in a crobjob that runs every 5 minutes to ensure settlements are done in time.
If settlements are not initiated in time, the channel will timeout and the deposit will be returned to the customer.

This is done to prevent malicious merchants to block the deposit and use that as leverage to ask for a higher settlement amount.

## Example

Create your own Django REST Framework view

```python
class PaymentChannelExampleView(PaymentChannelView):

    wei_per_request = 1000000000000000

    def get_request_data(self, channel):
        return "Paid content generated for {}".format(channel.from_address)
```

Call the view from the frontend

```javascript
var url = "http://127.0.0.1:8000/channel/initiate/";

App.getPaidContent(url, function(json) {
    $('#content').html(json.data)
})
```

