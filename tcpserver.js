var net = require('net');
var util = require('util');
var http = require('http'),
    colors = require('colors'),
    url = require('url'),
	querystring = require('querystring');

var HOST = '0.0.0.0';
var PORT = 8100;
var nWebServerPort = 8101;
var g_AllChromeClients = []
var g_AllGPSData = {}
var g_lastGPSData = {}

const log4js = require('log4js');
log4js.configure({
  appenders: { server: { type: 'file', filename: 'log/server.log',"maxLogSize": 10485760,"numBackups": 20
 },console: { type: 'console' },stream: { type: 'file', filename: 'log/stream.log',"maxLogSize": 10485760,"numBackups": 20
 }},
  categories: { default: { appenders: ['console','server'], level: 'debug' },stream:{appenders:['stream'],level: 'debug'}}
});
const logger = log4js.getLogger('server');
const loggerStream = log4js.getLogger('stream');

var clientForRoute = null;
var curSockForM30 = null;

function connCloud(){
    clientForRoute = new net.Socket();
    if (clientForRoute) {
        clientForRoute.connect(8100, '101.201.114.211', function() {
            logger.debug('智服云 Connected');
        });

        clientForRoute.on('data', function(data) {
            if (curSockForM30 != null) {
                try{
                    loggerStream.info('SEND ->')
                    loggerStream.info(data.toString('hex').toUpperCase())
                    curSockForM30.write(data)
                }
                catch(e_rror){
                    logger.error(e_rror)
                }
                curSockForM30 = null;
            }
        });

        clientForRoute.on('error', function(error) {
            logger.error(error)
        });

        clientForRoute.on('close', function() {
            logger.debug('智服云 Connection closed');
            setTimeout(function() {
                connCloud()
            },2000)
        });
    }
    
}

connCloud()


const tcpServer = net.createServer(function(sock) {

    logger.info('CONNECTED: ' + sock.remoteAddress + ':' + sock.remotePort);

    sock.on('data', function(data) {

        curSockForM30 = this
        if (clientForRoute != null) {
            try{
                loggerStream.info('RECV <-')
                loggerStream.info(data.toString('hex').toUpperCase())
                clientForRoute.write(data)
            }
            catch(e_rror){
                logger.error(e_rror)
            }
        }

        //logger.debug('DATA ' + sock.remoteAddress + ': ' +  Buffer.from(data).toString('hex') );
        var result = parseData(data)
        if (result != null && 
            result.position != null && 
            result.position.Latitude != 0 && 
            result.position.Longitude != 0 && 
            result.position.Latitude < 250 && 
            result.position.Longitude < 100
			) {
            logger.info(result.id + ' time:' + result.time.toLocaleString() + 
                ' Send Position(' + result.position.Latitude + ',' + result.position.Longitude+')')
            if (g_AllGPSData[result.id] == null) {
                g_AllGPSData[result.id] = []
            }
            if (g_lastGPSData[result.id] == null) {
                g_lastGPSData[result.id] = {}
            }

            if(g_AllGPSData[result.id].Latitude != result.position.Latitude || 
                g_AllGPSData[result.id].Longitude != result.position.Longitude )
            {

                g_AllGPSData[result.id].Latitude = result.position.Latitude
                g_AllGPSData[result.id].Longitude = result.position.Longitude

                gpsToAmapLoc({Latitude:result.position.Latitude,
                    Longitude:result.position.Longitude},function(gps){
                       result.position.gpsLat = result.position.Latitude
                       result.position.gpsLong = result.position.Longitude
                       result.position.Latitude = gps.Latitude
                       result.position.Longitude = gps.Longitude
                       NotifyAllClient(result)
                       g_AllGPSData[result.id].push(result)
                       SaveFile();
                })
                
            }
        }
        //sock.write('OK');
    });

    sock.on('close', function(data) {
        logger.info('CLOSED: ' + sock.remoteAddress + ' ' + sock.remotePort);
    });
    sock.on('error', function(err) {
        logger.error(err);
    });

}).listen(PORT, HOST,function(){
    logger.info('Server listening on ' + tcpServer.address().address +':'+ tcpServer.address().port);
});

tcpServer.on('error', function(err){
  logger.error(err)
});

// ************* WebSock Server

var ws = require("nodejs-websocket")
var wsserver = ws.createServer(function (conn) {
    g_AllChromeClients.push(conn);
    logger.info('websocket client come in.')
    conn.on("text", function (str) {
        try{
           var obj = JSON.parse(str);
           if (typeof obj.cmd != 'undefined') {
            var cmd = obj.cmd;
            if( cmd == 'req_gps' ){
                var msg = JSON.stringify({cmd:'return_gps_all',data:g_AllGPSData});
                conn.sendText(msg)
                //SaveFile()
            }
           }
        }
        catch(err){
            logger.error(err)
        }
       
    });
    conn.on("close", function (code, reason) {
        logger.info("Connection closed");
        var pos = g_AllChromeClients.indexOf(this);
        if (pos >= 0) {
            g_AllChromeClients.splice(pos,1);
        }
    });

    conn.on('error',function(err){
        
    });
}).listen(nWebServerPort)

wsserver.on('error',function(err){
    logger.error(err)
});

nWebServerPort = wsserver.socket.address().port;

//---------------------------------------------------------------------------

function gpsToAmapLoc(gps,fun){
    if(gps == null)
        return

    httpSend('http://restapi.amap.com/v3/assistant/coordinate/convert?key=b7d17e8052cdb0ad5a51ca02fd2afdb5&locations=' + gps.Latitude +',' + gps.Longitude +'&coordsys=gps'
        ,null,null,null,function(data,error){
        try{
            if(error == null)
            {
                var retJson = JSON.parse(data)
                if(retJson != null && 
                    retJson.status == '1'){
                    var loc = retJson.locations
                    var lr = loc.match(/([\d\.]{1,}),([\d\.]{1,})/i)
                    if(lr != null && lr.length >= 3){
                        if(fun != null)
                            fun({Latitude:parseFloat(lr[1]),Longitude:parseFloat(lr[2])});
                    }
                    else{
                        logger.error('gpsToAmapLoc convert fail')
                        logger.error(data)
                    }
                }
                else{
                    logger.error('gpsToAmapLoc convert fail')
                    logger.error(data)
                }
            }
            else{
                 logger.error(error)
            }
            
        }catch(e){
            logger.error(e)
        }
    })
}


function url_to_option(urlstr,method,postData,headerSend) {
    // body...
    if (urlstr === null) {
        urlstr = '';
    }
    var Url = url.parse(urlstr);
    var retOpt = {hostname:Url.hostname,port:Url.port,path:Url.path,method:(method === null ? 'GET':method)};
    if ( method === 'POST' ) {
        var header = retOpt['headers'];
        if ( typeof(header) === 'undefined' ) {
            header = {};
        }
        header['Content-Type'] = 'application/x-www-form-urlencoded';
        header['Content-Length'] = Buffer.byteLength(postData);
    }
    if ( headerSend != null ) {
        if( typeof(retOpt['headers']) === 'undefined' ){
            retOpt['headers'] = {};
        }
        for (var key in headerSend) {
            if ('host' != key) {
                retOpt['headers'][key] = headerSend[key];
            }
        }
    }

    return retOpt;
}

function httpSend(urlstr,method,postData,header,callback) {
    // body...
    var req = http.request(url_to_option(urlstr,method,postData,header), function(res){
        var responseContent = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk){
            responseContent += chunk;
        });
        res.on('end', function() {
            //console.log('response = ' + responseContent);
            if(callback != null){
                callback(responseContent,null);
            }
        });
    });

    req.on('error', function(e) {
        if(callback != null){
            callback(null,e.message);
        }
    });

    if (method === 'POST' && postData != null && postData !='') {
        req.write(postData);
    }
    req.end();
}

function parseTime(data){
    if (typeof data != 'object' || data == null) {
        logger.error(typeof data,offset)
        return null
    }
    var offset = 0
    var date = '20' + data.toString('hex')
    var strDate = util.format('%s-%s-%s %s:%s:%s',date.substr(0,4),date.substr(4,2),date.substr(6,2)
        ,date.substr(8,2),date.substr(10,2),date.substr(12,2))
    
    return new Date(strDate).toLocaleString()
}

function parsePosition(data,src,offset){
    var result = {}
    if (typeof data != 'object' || data == null) {
        logger.error(typeof data,offset)
        return null
    }
    result.speed = 0
    result.arc = 0
    result.offset = offset
    result.Latitude = data.value.readUInt32BE() / 1000000.0
    result.Longitude = data.value.readUInt32BE(4) / 1000000.0
	result.type = 'lbs'
    if(data.type == 0x5078 && data.length == 8) { //GPS 定位
        var tlvData = null;
        //ProSigStInit
        tlvData = parseTlv(src,offset)
        result.speed = tlvData.value.readUInt16BE()
        offset = tlvData.offset

        tlvData = parseTlv(src,offset)
        result.arc = tlvData.value.readUInt16BE()
        offset = tlvData.offset

        result.offset = offset
		result.type = 'gps'
    }
    return result
}

function parseTlv(data,offset){
    var result = {};
    if (typeof data != 'object' || data == null || offset >= data.length) {
        logger.error(typeof data,offset)
        return null
    }
    result.type = data.readUInt16BE(offset)
    result.length = data.readUInt16BE(offset + 2)
    if (result.length <= 20) {
        result.value = data.slice(offset + 4,offset + 4 + result.length)
    }
    result.offset = offset + 4 + result.length
    return result
}

function parseData(data){
    var result = {};
    if (typeof data != 'object' || data == null) {
        logger.error(typeof data)
        return null
    }
    try{
        var action = data.readUInt16BE(6)
        if (action != 0x4E02) {
            logger.error('not gps data')
            logger.error(data.toString('hex').toUpperCase())
            return null
        }
        var offset = 18;
        var tlvData = null;
        tlvData = parseTlv(data,offset)
        offset = tlvData.offset
        result.id = tlvData.value.toString('hex').toUpperCase();

        //ProSigStInit
        tlvData = parseTlv(data,offset)
        offset = tlvData.offset

        //ProValuesInit
        tlvData = parseTlv(data,offset)
        offset = tlvData.offset
        //time
        tlvData = parseTlv(data,offset)
        result.time = parseTime(tlvData.value)
        offset = tlvData.offset
        //POSITION
        tlvData = parseTlv(data,offset)
        offset = tlvData.offset
        result.position = parsePosition(tlvData,data,offset)
        offset = result.position.offset
        delete result.position.offset
        return result
    }
    catch(e){
        logger.error(e)
    }

    return null
}

var fs = require('fs'),
path = require('path');
function ReadInitData(){
    try{
        fs.readFile('data.json', {flag: 'r', encoding: 'utf8'}, function (err,data) {
           if(err) {
                logger.error(err);
            }
            else{
                try{
                    g_AllGPSData = JSON.parse(data)
                    //convertLoc()
                }
                catch(err){
                    logger.error(err)
                }
            }
        });
    }
    catch(e){
        logger.error(e)
    }
}

ReadInitData();

function SaveFile(){

    try{
        fs.writeFile('data.json', JSON.stringify(g_AllGPSData), {flag: 'w'}, function (err) {
           if(err) {
                logger.error(err);
            }
        });
    }
    catch(e){
        logger.error(e)
    }
}

function NotifyAllClient(data){
    for (var i = 0; i < g_AllChromeClients.length; i++) {
        g_AllChromeClients[i].sendText(JSON.stringify({cmd:'return_gps_append',data:data}))
    }
}

function convertLoc(){
    for(var key in g_AllGPSData){
        if(typeof g_AllGPSData[key] == 'object'){
            var GPSS = g_AllGPSData[key]
            for (var i = 0; i < GPSS.length; i++) {
                (function(g){
                    var gps = g

                    if(gps.type != null)
                    {
                        gps.position.type = gps.type
                        delete gps.type
                    }

                    /*gpsToAmapLoc({Latitude:gps.position.Latitude,
                        Longitude:gps.position.Longitude},function(amapLoc){
                        gps.position.Latitude = amapLoc.Latitude
                        gps.position.Longitude = amapLoc.Longitude
                        if (gps.position.speed != 0 || gps.position.arc != 0 ) {
                            gps.position.speed = gps.position.speed / 10.0
                            gps.type = 'gps'
                        }
                        else{
                            gps.type = 'lbs'
                        }
                    })*/
                })(GPSS[i])
            }
        }
    }
}

