cryptonote-stellite-pool
======================

High performance Node.js (with native C addons) mining pool for Stellite only. Comes with lightweight example front-end script which uses the pool's AJAX API.



#### Table of Contents
* [Features](#features)
* [Community Support](#community--support)
* [Pools Using This Software](#pools-using-this-software)
* [Usage](#usage)
  * [Requirements](#requirements)
  * [Downloading & Installing](#1-downloading--installing)
  * [Configuration](#2-configuration)
  * [Starting the Pool](#3-start-the-pool)
  * [Host the front-end](#4-host-the-front-end)
  * [Customizing your website](#5-customize-your-website)
  * [SSL](#ssl)
  * [Upgrading](#upgrading)
* [JSON-RPC Commands from CLI](#json-rpc-commands-from-cli)
* [Monitoring Your Pool](#monitoring-your-pool)
* [Donations](#donations)
* [Credits](#credits)
* [License](#license)


Features
===

#### Optimized pool server
* TCP (stratum-like) protocol for server-push based jobs
  * Compared to old HTTP protocol, this has a higher hash rate, lower network/CPU server load, lower orphan
    block percent, and less error prone
* IP banning to prevent low-diff share attacks
* Socket flooding detection
* Share trust algorithm to reduce share validation hashing CPU load
* Clustering for vertical scaling
* Ability to configure multiple ports - each with their own difficulty
* Miner login (wallet address) validation
* Workers identification (specify worker name as the password)
* Variable difficulty / share limiter
* Set fixed difficulty on miner client by passing "address" param with "+[difficulty]" postfix
* Modular components for horizontal scaling (pool server, database, stats/API, payment processing, front-end)
* SSL support for both pool and API servers

#### Live statistics API
* Currency network/block difficulty
* Current block height
* Network hashrate
* Pool hashrate
* Each miners' individual stats (hashrate, shares submitted, pending balance, total paid, payout estimate, etc)
* Blocks found (pending, confirmed, and orphaned)
* Historic charts of pool's hashrate, miners count and coin difficulty
* Historic charts of users's hashrate and payments

#### Mined blocks explorer
* Mined blocks table with block status (pending, confirmed, and orphaned)
* Blocks luck (shares/difficulty) statistics
* Universal blocks and transactions explorer based on [explorer.stellite.cash](https://explorer.stellite.cash)

#### Smart payment processing
* Splintered transactions to deal with max transaction size
* Minimum payment threshold before balance will be paid out
* Minimum denomination for truncating payment amount precision to reduce size/complexity of block transactions
* Prevent "transaction is too big" error with "payments.maxTransactionAmount" option
* Option to enable dynamic transfer fee based on number of payees per transaction and option to have miner pay transfer fee instead of pool owner (applied to dynamic fee only)
* Control transactions priority with config.payments.priority (default: 0).
* Set payment ID on miner client when using "[address].[paymentID]" login
* Integrated payment ID addresses support for Exchanges

#### Admin panel
* Aggregated pool statistics
* Coin daemon & wallet RPC services stability monitoring
* Log files data access
* Users list with detailed statistics

#### Pool stability monitoring
* Detailed logging in process console & log files
* Coin daemon & wallet RPC services stability monitoring
* See logs data from admin panel

#### Extra features
* An easily extendable, responsive, light-weight front-end using API to display data
* Onishin's [keepalive function](https://github.com/perl5577/cpuminer-multi/commit/0c8aedb)
* Support for slush mining system (disabled by default)
* E-Mail Notifications on worker connected, disconnected (timeout) or banned (support MailGun, SMTP and Sendmail)


Community / Support
===

* [GitHub Issues for cryptonote-stellite-pool](https://github.com/nagrath/cryptonote-stellite-pool/issues)
* [Discord](https://discord.gg/xnY6SeD)

#### Pools Using This Software

* https://xtlpool.com
* http://stellite.poolclub.cafe
* http://dearmon.zone/stellite


Usage
===

#### Requirements
* Coin daemon(s) (find the coin's repo and build latest version from source)
  * [Stellite Coin](https://github.com/stellitecoin/Stellite)
* [Node.js](http://nodejs.org/) v4.0+
  * For Ubuntu: `sudo apt-get install nodejs npm && ln -s /usr/bin/nodejs /usr/bin/node`
* [Redis](http://redis.io/) key-value store v2.6+ ([follow these instructions](http://redis.io/topics/quickstart))
* libssl required for the node-multi-hashing module
  * For Ubuntu: `sudo apt-get install libssl-dev`
* Boost is required for the cryptonote-util module
  * For Ubuntu: `sudo apt-get install libboost-all-dev`


##### Seriously
Those are legitimate requirements. If you use old versions of Node.js or Redis that may come with your system package manager then you will have problems. Follow the linked instructions to get the last stable versions.


[**Redis security warning**](http://redis.io/topics/security): be sure firewall access to redis - an easy way is to
include `bind 127.0.0.1` in your `redis.conf` file. Also it's a good idea to learn about and understand software that
you are using - a good place to start with redis is [data persistence](http://redis.io/topics/persistence).

#### 1) Downloading & Installing


Clone the repository and run `npm update` for all the dependencies to be installed:

```bash
curl https://raw.githubusercontent.com/creationix/nvm/v0.33.9/install.sh | bash
nvm install 4.8
nvm use 4.8
nvm alias default 4.8
nvm use default

git clone https://github.com/nagrath/cryptonote-stellite-pool.git pool
cd pool

npm update
```

#### 2) Configuration

Copy the `config.default.json` file to `config.json` then overview each options and change any to match your preferred setup.

Explanation for each field:
```javascript
/* Used for storage in redis so multiple coins can share the same redis instance. */
"coin": "StelliteCoin",

/* Used for front-end display */
"symbol": "XTL",

/* Minimum units in a single coin, see COIN constant in DAEMON_CODE/src/cryptonote_config.h */
"coinUnits": 100,

/* Coin network time to mine one block, see DIFFICULTY_TARGET constant in DAEMON_CODE/src/cryptonote_config.h */
"coinDifficultyTarget": 60,

/* Logging */
"logging": {

    "files": {

        /* Specifies the level of log output verbosity. This level and anything
           more severe will be logged. Options are: info, warn, or error. */
        "level": "info",

        /* Directory where to write log files. */
        "directory": "logs",

        /* How often (in seconds) to append/flush data to the log files. */
        "flushInterval": 5
    },

    "console": {
        "level": "info",
        /* Gives console output useful colors. If you direct that output to a log file
           then disable this feature to avoid nasty characters in the file. */
        "colors": true
    }
},

/* Modular Pool Server */
"poolServer": {
    "enabled": true,

    /* Set to "auto" by default which will spawn one process/fork/worker for each CPU
       core in your system. Each of these workers will run a separate instance of your
       pool(s), and the kernel will load balance miners using these forks. Optionally,
       the 'forks' field can be a number for how many forks will be spawned. */
    "clusterForks": "auto",

    /* Address where block rewards go, and miner payments come from. */
    "poolAddress": "Se48Y3rP4Q7iyTU1Gvj7uRFt9tQWgjNCqFArHPPj6wFharsZvW1pSaj5EemuiaQWdP79FKzx1ZT3V6ii3Puuz5wo37Fo4Rpeg",
    /* Poll RPC daemons for new blocks every this many milliseconds. */
    "blockRefreshInterval": 200,

    /* How many seconds until we consider a miner disconnected. */
    "minerTimeout": 900,

    "sslCert": "./cert.pem", // The SSL certificate
    "sslKey": "./privkey.pem", // The SSL private key
    "sslCA": "./chain.pem" // The SSL certificate authority chain
    
    "ports": [
	    {
                "port": 3933, // Port for mining apps to connect to
                "difficulty": 2000, // Initial difficulty miners are set to
                "desc": "Low end hardware (50 ~ 100H/s) diff: 2000" // Description of port
            },
            {
                "port": 4944,
                "difficulty": 20000,
                "desc": "Mid range hardware (~ 500H/s) diff: 20000"
            },
             {
                "port": 5955,
                "difficulty": 100000,
                "desc": "High end hardware (> 2.5kH/s) dif: 100000"
            },
           {
                "port": 8988,
                "difficulty": 50,
                "desc": "Web mining or mobiles (1 ~ 50H/s) dif: 50"
            }

    ],

    /* Variable difficulty is a feature that will automatically adjust difficulty for
       individual miners based on their hashrate in order to lower networking and CPU
       overhead. */
    "varDiff": {
        "minDiff": 50, // Minimum difficulty
        "maxDiff": 100000000,
        "targetTime": 60, // Try to get 1 share per this many seconds
        "retargetTime": 30, // Check to see if we should retarget every this many seconds
        "variancePercent": 30, // Allow time to vary this % from target without retargeting
        "maxJump": 100 // Limit diff percent increase/decrease in a single retargeting
    },

    /* Set payment ID on miner client side by passing <address>.<paymentID> */
    "paymentId": {
        "addressSeparator": "." // Character separator between <address> and <paymentID>
    },
	
    /* Set difficulty on miner client side by passing <address> param with +<difficulty> postfix */
    "fixedDiff": {
        "enabled": true,
        "separator": "+", // Character separator between <address> and <difficulty>
    },

    /* Feature to trust share difficulties from miners which can
       significantly reduce CPU load. */
    "shareTrust": {
        "enabled": true,
        "min": 10, // Minimum percent probability for share hashing
        "stepDown": 3, // Increase trust probability % this much with each valid share
        "threshold": 10, // Amount of valid shares required before trusting begins
        "penalty": 30 // Upon breaking trust require this many valid share before trusting
    },

    /* If under low-diff share attack we can ban their IP to reduce system/network load. */
    "banning": {
        "enabled": true,
        "time": 600, // How many seconds to ban worker for
        "invalidPercent": 25, // What percent of invalid shares triggers ban
        "checkThreshold": 30 // Perform check when this many shares have been submitted
    },
    
    /* Slush Mining is a reward calculation technique which disincentivizes pool hopping and rewards 'loyal' miners by valuing younger shares higher than older shares. Remember adjusting the weight!
    More about it here: https://mining.bitcoin.cz/help/#!/manual/rewards */
    "slushMining": {
        "enabled": false, // Enables slush mining. Recommended for pools catering to professional miners
        "weight": 300, // Defines how fast the score assigned to a share declines in time. The value should roughly be equivalent to the average round duration in seconds divided by 8. When deviating by too much numbers may get too high for JS.
        "blockTime": 60
        "lastBlockCheckRate": 1 // How often the pool checks the timestamp of the last block. Lower numbers increase load but raise precision of the share value
    }
},

/* Module that sends payments to miners according to their submitted shares. */
"payments": {
    "enabled": true,
    "interval": 300, // How often to run in seconds
    "maxAddresses": 50, // Split up payments if sending to more than this many addresses
    "mixin": 5, // Number of transactions yours is indistinguishable from
    "priority": 0, // The transaction priority    
    "transferFee": 200, // Fee to pay for each transaction
    "dynamicTransferFee": true, // Enable dynamic transfer fee (fee is multiplied by number of miners)
    "minerPayFee" : true, // Miner pays the transfer fee instead of pool owner when using dynamic transfer fee
    "minPayment": 10000, // Miner balance required before sending payment
    "maxTransactionAmount": 0, // Split transactions by this amount (to prevent "too big transaction" error)
    "denomination": 1// Truncate to this precision and store remainder
},

/* Module that monitors the submitted block maturities and manages rounds. Confirmed
   blocks mark the end of a round where workers' balances are increased in proportion
   to their shares. */
"blockUnlocker": {
    "enabled": true,
    "interval": 30, // How often to check block statuses in seconds

    /* Block depth required for a block to unlocked/mature. Found in daemon source as
       the variable CRYPTONOTE_MINED_MONEY_UNLOCK_WINDOW */
    "depth": 60,
    "poolFee": 1, // 1% pool fee
    "devDonation": 0
},

/* AJAX API used for front-end website. */
"api": {
    "enabled": true,
    "hashrateWindow": 600, // How many second worth of shares used to estimate hash rate
    "updateInterval": 3, // Gather stats and broadcast every this many seconds
    "port": 8917, // The API port
    "blocks": 30, // Amount of blocks to send at a time
    "payments": 30, // Amount of payments to send at a time
    "password": "your_password", // Password required for admin stats,
    "bindIp":"127.0.0.1",//Allow bind to certain ip
    "ssl": false, // Enable SSL API
    "sslPort": 8119, // The SSL port
    "sslCert": "./cert.pem", // The SSL certificate
    "sslKey": "./privkey.pem", // The SSL private key
    "sslCA": "./chain.pem", // The SSL certificate authority chain
    "trustProxyIP": false // Proxy X-Forwarded-For support,
    "bindIpSSL":"127.0.0.1",//Allow bind to certain ip for ssl connection
},

/* Coin daemon connection details (default port is 18981) */
"daemon": {
    "host": "127.0.0.1",
    "port": 20189
},

/* Wallet daemon connection details (default port is 18980) */
"wallet": {
    "host": "127.0.0.1",
    "port": 18982
},

/* Redis connection into (default port is 6379) */
"redis": {
    "host": "127.0.0.1",
    "port": 6379,
    "auth": null // If set, client will run redis auth command on connect. Use for remote db
    "db" : 0 //Select which db to use in redis
}

/* Email Notifications */
"email": {
    "enabled": false,
    "templateDir": "email_templates", // The templates folder
    "templates": ["worker_connected", "worker_banned", "worker_timeout"], // Specify which templates to enable
    "variables": { // The variables to replace in templates
        "POOL_HOST": "poolhost.com" // Your pool domain
    },
    "fromAddress": "your@email.com", // Your sender email
    "transport": "sendmail", // The transport mode (sendmail, smtp or mailgun)
    
    // Configuration for sendmail transport
    // Documentation: http://nodemailer.com/transports/sendmail/
    "sendmail": {
        "path": "/usr/sbin/sendmail" // The path to sendmail command
    },
    
    // Configuration for SMTP transport
    // Documentation: http://nodemailer.com/smtp/
    "smtp": {
        "host": "smtp.example.com", // SMTP server
        "port": 587, // SMTP port (25, 587 or 465)
        "secure": false, // TLS (if false will upgrade with STARTTLS)
        "auth": {
            "user": "username", // SMTP username
            "pass": "password" // SMTP password
        }
    },
    
    // Configuration for MailGun transport
    "mailgun": {
        "key": "your-private-key", // Your MailGun Private API key
        "domain": "mg.yourdomain" // Your MailGun domain
    }
},
    
/* Monitoring RPC services. Statistics will be displayed in Admin panel */
"monitoring": {
    "daemon": {
        "checkInterval": 60, // Interval of sending rpcMethod request
        "rpcMethod": "getblockcount" // RPC method name
    },
    "wallet": {
        "checkInterval": 60,
        "rpcMethod": "getbalance"
    }
},

/* Prices settings for market and price charts */
"prices": {
    "source": "cryptonator", // Price source (cryptonator or tradeogre)
    "currency": "USD" // Default currency
},
	    
/* Collect pool statistics to display in frontend charts  */
"charts": {
    "pool": {
        "hashrate": {
            "enabled": true, // Enable data collection and chart displaying in frontend
            "updateInterval": 60, // How often to get current value
            "stepInterval": 1800, // Chart step interval calculated as average of all updated values
            "maximumPeriod": 86400 // Chart maximum periods (chart points number = maximumPeriod / stepInterval = 48)
        },
        "miners": {
            "enabled": true,
            "updateInterval": 60,
            "stepInterval": 1800,
            "maximumPeriod": 86400
        },
        "workers": {
            "enabled": true,
            "updateInterval": 60,
            "stepInterval": 1800,
            "maximumPeriod": 86400
        },
        "difficulty": {
            "enabled": true,
            "updateInterval": 1800,
            "stepInterval": 10800,
            "maximumPeriod": 604800
        },
        "price": {
            "enabled": true,
            "updateInterval": 1800,
            "stepInterval": 10800,
            "maximumPeriod": 604800
        },
        "profit": {
            "enabled": true,
            "updateInterval": 1800,
            "stepInterval": 10800,
            "maximumPeriod": 604800
        }

    },
    "user": { // Chart data displayed in user stats block
        "hashrate": {
            "enabled": true,
            "updateInterval": 180,
            "stepInterval": 1800,
            "maximumPeriod": 86400
        },
        "payments": { // Payment chart uses all user payments data stored in DB
            "enabled": true
        }
    }
```

#### 3) Start the pool

```bash
node init.js
```

The file `config.json` is used by default but a file can be specified using the `-config=file` command argument, for example:

```bash
node init.js -config=config_backup.json
```

This software contains four distinct modules:
* `pool` - Which opens ports for miners to connect and processes shares
* `api` - Used by the website to display network, pool and miners' data
* `unlocker` - Processes block candidates and increases miners' balances when blocks are unlocked
* `payments` - Sends out payments to miners according to their balances stored in redis


By default, running the `init.js` script will start up all four modules. You can optionally have the script start
only start a specific module by using the `-module=name` command argument, for example:

```bash
node init.js -module=api
```

[Example screenshot](http://i.imgur.com/SEgrI3b.png) of running the pool in single module mode with tmux.


#### 4) Host the front-end

Simply host the contents of the `website_example` directory on file server capable of serving simple static files.


Edit the variables in the `website_example/config.js` file to use your pool's specific configuration.
Variable explanations:

```javascript

/* Must point to the API setup in your config.json file. */
var api = "http://poolhost:8917";

/* Pool server host to instruct your miners to point to.  */
var poolHost = "poolhost.com";

/* Contact email address. */
var email = "support@poolhost.com";

/* Pool Telegram URL. */
var telegram = "https://t.me/YourPool";

/* Pool Discord URL */
var discord = "https://discordapp.com/invite/YourPool";

/* Market stat display params from https://www.cryptonator.com/widget */
var cryptonatorWidget = ["{symbol}-BTC", "{symbol}-USD", "{symbol}-EUR", "{symbol}-CAD"];

/* Default currency used by Estimate Mining Profit tool */
var defaultCurrency = 'USD';

/* Used for front-end block links. */
var blockchainExplorer = "https://explorer.stellite.cash/search?value={id}";

/* Used by front-end transaction links. */
var transactionExplorer = "https://explorer.stellite.cash/search?value={id}";


/* Any custom CSS theme for pool frontend */
var themeCss = "themes/stellite.css";

```

#### 5) Customize your website

The following files are included so that you can customize your pool website without having to make significant changes
to `index.html` or other front-end files thus reducing the difficulty of merging updates with your own changes:
* `custom.css` for creating your own pool style
* `custom.js` for changing the functionality of your pool website


Then simply serve the files via nginx, Apache, Google Drive, or anything that can host static content.

#### SSL

You can configure the API to be accessible via SSL using various methods. Find an example for nginx below:
* Inside your SSL Listener, add the following:

``` javascript
location ~ ^/api/(.*) {
    proxy_pass http://127.0.0.1:8117/$1$is_args$args;
}
```

* Using SSL api in `config.json`:

By adding this you will need to update your `api` variable in the `website_example/config.js` to include the /api. For example:  
`var api = "http://xtlpool.com/api";`

You no longer need to include the port in the variable because of the proxy connection.

* Using his own subdomain, for example `api.poolhost.com`:

```bash
server {
    server_name api.xtlpool.com
    listen 443 ssl http2;

    ssl_certificate /your/ssl/certificate;
    ssl_certificate_key /your/ssl/certificate_key;

    location / {
        more_set_headers 'Access-Control-Allow-Origin: *';
        proxy_pass http://127.0.01:8117;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

By adding this you will need to update your `api` variable in the `website_example/config.js`. For example:  
`var api = "//api.xtlpool.com";`

You no longer need to include the port in the variable because of the proxy connection.


#### Upgrading
When updating to the latest code its important to not only `git pull` the latest from this repo, but to also update
the Node.js modules, and any config files that may have been changed.
* Inside your pool directory (where the init.js script is) do `git pull` to get the latest code.
* Remove the dependencies by deleting the `node_modules` directory with `rm -r node_modules`.
* Run `npm update` to force updating/reinstalling of the dependencies.
* Compare your `config.json` to the latest example ones in this repo or the ones in the setup instructions where each config field is explained. You may need to modify or add any new changes.

### JSON-RPC Commands from CLI

Documentation for JSON-RPC commands can be found here:
* Daemon https://wiki.bytecoin.org/wiki/Daemon_JSON_RPC_API
* Wallet https://wiki.bytecoin.org/wiki/Wallet_JSON_RPC_API


Curl can be used to use the JSON-RPC commands from command-line. Here is an example of calling `getblockheaderbyheight` for block 100:

```bash
curl 127.0.0.1:20189/json_rpc -d '{"method":"getblockheaderbyheight","params":{"height":100}}'
```


### Monitoring Your Pool

* To inspect and make changes to redis I suggest using [redis-commander](https://github.com/joeferner/redis-commander)
* To monitor server load for CPU, Network, IO, etc - I suggest using [New Relic](http://newrelic.com/)
* To keep your pool node script running in background, logging to file, and automatically restarting if it crashes - I suggest using [pm2](https://github.com/Unitech/pm2)


Donations
---------
* BTC: `1Bv5r7D5D8HesLijZ3vC8vLoJmfXFjyopi`
* XTL: `Se2tMdv3zXFWZtvNnXEhJFKakfKQxQ1JF1q7dyLuk6mvVeP2C77QeX5D8EAjuiuaochTEDsPUSe3oScVW8DK8uhu1yBxJ7oHH`

Credits
---------

* [dvandal/cryptonote-nodejs-pool](//github.com/dvandal/cryptonote-nodejs-pool)
* [cryptoknight.cc](//cryptoknight.cc)
* [fairhash.org](//fairhash.org)
* [ahmyi/cryptonote-stellite-pool](//github.com/ahmyi/cryptonote-stellite-pool)

License
-------
Released under the GNU General Public License v2

http://www.gnu.org/licenses/gpl-2.0.html
