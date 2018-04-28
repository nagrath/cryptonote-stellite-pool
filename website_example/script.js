$('#menu-content').collapse('hide');

var currentPage;
var lastStats;

var docCookies = {
    getItem: function (sKey) {
        return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(sKey).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
    },
    setItem: function (sKey, sValue, vEnd, sPath, sDomain, bSecure) {
        if (!sKey || /^(?:expires|max\-age|path|domain|secure)$/i.test(sKey)) { return false; }
        var sExpires = "";
        if (vEnd) {
            switch (vEnd.constructor) {
                case Number:
                    sExpires = vEnd === Infinity ? "; expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + vEnd;
                    break;
                case String:
                    sExpires = "; expires=" + vEnd;
                    break;
                case Date:
                    sExpires = "; expires=" + vEnd.toUTCString();
                    break;
            }
        }
        document.cookie = encodeURIComponent(sKey) + "=" + encodeURIComponent(sValue) + sExpires + (sDomain ? "; domain=" + sDomain : "") + (sPath ? "; path=" + sPath : "") + (bSecure ? "; secure" : "");
        return true;
    },
    removeItem: function (sKey, sPath, sDomain) {
        if (!sKey || !this.hasItem(sKey)) { return false; }
        document.cookie = encodeURIComponent(sKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT" + ( sDomain ? "; domain=" + sDomain : "") + ( sPath ? "; path=" + sPath : "");
        return true;
    },
    hasItem: function (sKey) {
        return (new RegExp("(?:^|;\\s*)" + encodeURIComponent(sKey).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=")).test(document.cookie);
    }
};

function getTransactionUrl(id) {
    return transactionExplorer.replace('{symbol}', lastStats.config.symbol.toLowerCase()).replace('{id}', id);
}

function getBlockchainUrl(id) {
    return blockchainExplorer.replace('{symbol}', lastStats.config.symbol.toLowerCase()).replace('{id}', id);
}
    
$.fn.update = function(txt){
    var el = this[0];
    if (el.textContent !== txt)
        el.textContent = txt;
    return this;
};

function updateTextClasses(className, text){
    var els = document.getElementsByClassName(className);
    if (els) {
        for (var i = 0; i < els.length; i++){
            var el = els[i];
            if (el && el.textContent !== text)
                el.textContent = text;
        }
    }
}

function updateText(elementId, text){
    var el = document.getElementById(elementId);
    if (el && el.textContent !== text){
        el.textContent = text;
    }
    return el;
}

function floatToString(float) {
    return float.toFixed(6).replace(/[0\.]+$/, '');
}

function getReadableTime(seconds){
    var units = [ [60, 'second'], [60, 'minute'], [24, 'hour'],
                [7, 'day'], [4, 'week'], [12, 'month'], [1, 'year'] ];

    function formatAmounts(amount, unit){
        var rounded = Math.round(amount);
        return '' + rounded + ' ' + unit + (rounded > 1 ? 's' : '');
    }

    var amount = seconds;
    for (var i = 0; i < units.length; i++){
        if (amount < units[i][0]) {
            return formatAmounts(amount, units[i][1]);
    }
        amount = amount / units[i][0];
    }
    return formatAmounts(amount,  units[units.length - 1][1]);
}

function getReadableHashRateString(hashrate){
    var i = 0;
    var byteUnits = [' H', ' KH', ' MH', ' GH', ' TH', ' PH' ];
    while (hashrate > 1000){
        hashrate = hashrate / 1000;
        i++;
    }
    return hashrate.toFixed(2) + byteUnits[i];
}
    
function getReadableCoins(coins, digits, withoutSymbol){
    var amount = (parseInt(coins || 0) / lastStats.config.coinUnits).toFixed(digits || lastStats.config.coinUnits.toString().length - 1);
    return amount + (withoutSymbol ? '' : (' ' + lastStats.config.symbol));
}

function formatDate(time){
    if (!time) return '';
    return new Date(parseInt(time) * 1000).toLocaleString();
}

function formatPaymentLink(hash){
    return '<a target="_blank" href="' + getTransactionUrl(hash) + '">' + hash + '</a>';
}

function getPaymentRowElement(payment, jsonString){
    var row = document.createElement('tr');
    row.setAttribute('data-json', jsonString);
    row.setAttribute('data-time', payment.time);
    row.setAttribute('id', 'paymentRow' + payment.time);

    row.innerHTML = getPaymentCells(payment);

    return row;
}

function parsePayment(time, serializedPayment){
    var parts = serializedPayment.split(':');
    return {
        time: parseInt(time),
        hash: parts[0],
        amount: parts[1],
        fee: parts[2],
        mixin: parts[3],
        recipients: parts[4]
    };
}

function renderPayments(paymentsResults){
    var $paymentsRows = $('#paymentsReport_rows');
    for (var i = 0; i < paymentsResults.length; i += 2){
        var payment = parsePayment(paymentsResults[i + 1], paymentsResults[i]);
        var paymentJson = JSON.stringify(payment);
        var existingRow = document.getElementById('paymentRow' + payment.time);

        if (existingRow && existingRow.getAttribute('data-json') !== paymentJson){
            $(existingRow).replaceWith(getPaymentRowElement(payment, paymentJson));
        }
        else if (!existingRow){
            var paymentElement = getPaymentRowElement(payment, paymentJson);

            var inserted = false;
            var rows = $paymentsRows.children().get();
            for (var f = 0; f < rows.length; f++) {
                var pTime = parseInt(rows[f].getAttribute('data-time'));
                if (pTime < payment.time){
                    inserted = true;
                    $(rows[f]).before(paymentElement);
                    break;
                }
            }
            if (!inserted) {
                $paymentsRows.append(paymentElement);
            }
        }
    }
}

function getCurrentAddress() {
    var urlWalletAddress = location.search.split('wallet=')[1] || 0;
    var address = urlWalletAddress || docCookies.getItem('mining_address');
    return address;
}

function pulseLiveUpdate(){
    var stats_update = document.getElementById('statsUpdated');
    stats_update.style.transition = 'opacity 100ms ease-out';
    stats_update.style.opacity = 1;
    setTimeout(function(){
        stats_update.style.transition = 'opacity 7000ms linear';
        stats_update.style.opacity = 0;
    }, 500);
}

function updateLiveStats(data) {
    pulseLiveUpdate();  
    lastStats = data;
    if (lastStats && lastStats.pool && lastStats.pool.totalMinersPaid.toString() == '-1'){
        lastStats.pool.totalMinersPaid = 0;
    }
    updateIndex();
    if (currentPage) currentPage.update();
}

function updateIndex(){
    updateText('g_networkHashrate', getReadableHashRateString(lastStats.network.difficulty / lastStats.config.coinDifficultyTarget) + '/sec');
    updateText('g_poolHashrate', getReadableHashRateString(lastStats.pool.hashrate) + '/sec');    
    if (lastStats.miner && lastStats.miner.hashrate){
         updateText('g_userHashrate', getReadableHashRateString(lastStats.miner.hashrate) + '/sec');
    }
    else{
        updateText('g_userHashrate', 'N/A');
    }    
    updateText('poolVersion', lastStats.config.version);
}

function loadLiveStats(reload) {
    var apiURL = api + '/stats';
    
    var address = getCurrentAddress();
    if (address) { apiURL = apiURL + '?address=' + address; }

    if (xhrLiveStats) xhrLiveStats.abort();
    
    $.get(apiURL, function(data){        
        updateLiveStats(data);
    if (!reload) routePage(fetchLiveStats);
    });
}

var xhrLiveStats;
function fetchLiveStats() {
    var apiURL = api + '/live_stats';

    var address = getCurrentAddress();
    if (address) { apiURL = apiURL + '?address=' + address; }
    
    xhrLiveStats = $.ajax({
        url: apiURL,
        dataType: 'json',
        cache: 'false'
    }).done(function(data){
        updateLiveStats(data);
    }).always(function(){
        fetchLiveStats();
    });
}

window.onhashchange = function(){
    routePage();
};

var xhrPageLoading;
function routePage(loadedCallback) {
    if (currentPage) currentPage.destroy();
    $('#page').html('');
    $('#loading').show();

    if (xhrPageLoading) {
        xhrPageLoading.abort();
    }

    $('.hot_link').parent().removeClass('active');
    var $link = $('a.hot_link[href="' + (window.location.hash || '#') + '"]');
    
    $link.parent().addClass('active');
    var page = $link.data('page');

    xhrPageLoading = $.ajax({
        url: 'pages/' + page,
        cache: false,
        success: function (data) {
            $('#menu-content').collapse('hide');
            $('#loading').hide();
            $('#page').show().html(data);
            if (currentPage) currentPage.update();
            if (loadedCallback) loadedCallback();
        }
    });
}

function sortTable() {
    var table = $(this).parents('table').eq(0),
        rows = table.find('tr:gt(0)').toArray().sort(comparer($(this).index()));
    this.asc = !this.asc;
    if(!this.asc) {
        rows = rows.reverse()
    }
    for(var i = 0; i < rows.length; i++) {
        table.append(rows[i])
    }
}

function comparer(index) {
    return function(a, b) {
        var valA = getCellValue(a, index), valB = getCellValue(b, index);
    if (!valA) { valA = 0; }
    if (!valB) { valB = 0; }
        return $.isNumeric(valA) && $.isNumeric(valB) ? valA - valB : valA.toString().localeCompare(valB.toString())
    }
}

function getCellValue(row, index) {
    return $(row).children('td').eq(index).data("sort")
}

$(function(){

    $("head").append("<link rel='stylesheet' href=" + themeCss + ">");
    if (telegram) {
        $('#menu-content').append('<li><a target="_new" href="'+telegram+'"><i class="fa fa-telegram"></i> Telegram group</a></li>');
    }
    if (discord) {
        $('#menu-content').append('<li><a target="_new" href="'+discord+'"><i class="fa fa-ticket"></i> Discord</a></li>');
    }
    if (email) {
        $('#menu-content').append('<li><a target="_new" href="mailto:'+email+'"><i class="fa fa-envelope"></i> Contact Us</a></li>');
    }

    loadLiveStats();
});