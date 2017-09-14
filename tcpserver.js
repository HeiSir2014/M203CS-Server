var net = require('net');
var util = require('util');
var http = require('http'),
    colors = require('colors'),
    url = require('url'),
    querystring = require('querystring'),
    formurlencoded = require('form-urlencoded');

var HOST = '0.0.0.0';
var PORT = 8100;
var nWebServerPort = 8101;
var g_AllChromeClients = []
var g_AllGPSData = {}
var g_lastGPSData = {}
var g_AllClientsOfSocket = {}

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
            result.position != null
            ) {
            var id = result.id;
            if (g_AllClientsOfSocket[id] == null) {
                g_AllClientsOfSocket[id] = this;
                sendHeartTime(id,60)
            }

            g_AllClientsOfSocket[id] = this;
            var lat = result.position.Latitude;
            var lng = result.position.Longitude;
            if( lat != 0 &&
                lng != 0 && 
                lat < 180 &&
                lng > -180 &&
                lat < 90 &&
                lng > -90)
            {
                
                logger.info(result.id + ' time:' + result.time.toLocaleString() + 
                    ' Send Position(' + lng + ',' + lat +')')
                if (g_AllGPSData[id] == null) {
                    g_AllGPSData[id] = []
                }
                if (g_lastGPSData[id] == null) {
                    g_lastGPSData[id] = {}
                }
                
                if(g_lastGPSData[id].Latitude != lat || 
                    g_lastGPSData[id].Longitude != lng )
                {
                    g_lastGPSData[id].Latitude = lat
                    g_lastGPSData[id].Longitude = lng
                    gpsToAmapLoc({Latitude:lat,
                        Longitude:lng},function(gps){
                           result.position.Latitude = gps.Latitude
                           result.position.Longitude = gps.Longitude
                           NotifyAllClient(result)
                           g_AllGPSData[id].push(result)
                           SaveFile();
                    })
                }
                pointAddForYingYan(result)
            }
            else{
                logger.error("Illegal latlng , "+ id + ' time:' + result.time.toLocaleString() + 
                    ' latlng(' + result.position.Longitude + ',' + result.position.Latitude +')')
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
    logger.info('Start Server listening on ' + tcpServer.address().address + ':' + tcpServer.address().port);
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
                var all = {};
                var tNow = new Date().getTime();
                for(var key in g_AllGPSData){
                    if(typeof g_AllGPSData[key] == 'object'){
                        var gpss = g_AllGPSData[key]
                        all[key] = [];
                        var allgps = all[key];
                        for(var i = 0;i < gpss.length;i++){
                            var t = new Date(gpss[i].time).getTime()
                            if(tNow - t <= 86400000){
                                allgps.push(gpss[i])
                            }
                        }
                    }
                }
                
                var msg = JSON.stringify({cmd:'return_gps_all',data:all});
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

    httpSend('http://restapi.amap.com/v3/assistant/coordinate/convert?key=b7d17e8052cdb0ad5a51ca02fd2afdb5&locations=' + gps.Longitude +',' + gps.Latitude +'&coordsys=gps'
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
                            fun({Longitude:parseFloat(lr[1]),Latitude:parseFloat(lr[2])});
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

        retOpt['headers'] = header;
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
        res.on('error',function(err){

        })
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
    result.Longitude= data.value.readUInt32BE() / 1000000.0
    result.Latitude = data.value.readUInt32BE(4) / 1000000.0
    result.gpsLong = result.Longitude
    result.gpsLat = result.Latitude
	result.type = 'lbs'
    if(data.type == 0x5078 && data.length == 8) { //GPS 定位
        var tlvData = null;
        //ProSigStInit
        tlvData = parseTlv(src,offset)
        result.speed = tlvData.value.readUInt16BE() / 10.0
        offset = tlvData.offset

        tlvData = parseTlv(src,offset)
        result.arc = tlvData.value.readUInt16BE() / 100.0
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
                    pointAddForYingYan(gps,()=>{})
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

function entityAddForYingYan(sn,name,fun){
    var postData = formurlencoded({
        ak:'N3v3N6e2FmIX7A8d8N7shYp3a5OPISCD',
        service_id:'150014',
        entity_name:sn,
        entity_desc:name
    })
    httpSend('http://yingyan.baidu.com/api/v3/entity/add','POST',postData,null,function(data,error){
        if(error == null){
            logger.info(data)
            if(fun != null){
                fun()
            }
        }
        else{
            logger.error(error)
        }
    })
}

function pointAddForYingYan(request,fun){
    if (false && request.position.type != 'gps') {
        return
    }
    var postData = formurlencoded({
        ak:'N3v3N6e2FmIX7A8d8N7shYp3a5OPISCD',
        service_id:'150014',
        entity_name:request.id,
        latitude:request.position.gpsLat,
        longitude:request.position.gpsLong,
        loc_time:new Date(request.time).getTime()/1000,
        coord_type_input:'wgs84',
        speed:request.position.speed,
        direction:parseInt(request.position.arc)
    })
    httpSend('http://yingyan.baidu.com/api/v3/track/addpoint','POST',postData,null,function(data,error){
        if(error == null){
            logger.info(data)
            if(fun != null){
                fun()
            }
        }
        else{
            logger.error(error)
        }
    })
}

const auchCRCHi = [
        0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81,
        0x40, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0,
        0x80, 0x41, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x00, 0xC1, 0x81, 0x40, 0x01,
        0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x01, 0xC0, 0x80, 0x41,
        0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x00, 0xC1, 0x81,
        0x40, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x01, 0xC0,
        0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x01,
        0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40,
        0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81,
        0x40, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0,
        0x80, 0x41, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x00, 0xC1, 0x81, 0x40, 0x01,
        0xC0, 0x80, 0x41, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41,
        0x00, 0xC1, 0x81, 0x40, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81,
        0x40, 0x01, 0xC0, 0x80, 0x41, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0,
        0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x01,
        0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81, 0x40, 0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41,
        0x00, 0xC1, 0x81, 0x40, 0x01, 0xC0, 0x80, 0x41, 0x01, 0xC0, 0x80, 0x41, 0x00, 0xC1, 0x81,
        0x40 ];
const auchCRCLo = [
        0x00, 0xC0, 0xC1, 0x01, 0xC3, 0x03, 0x02, 0xC2, 0xC6, 0x06, 0x07, 0xC7, 0x05, 0xC5, 0xC4,
        0x04, 0xCC, 0x0C, 0x0D, 0xCD, 0x0F, 0xCF, 0xCE, 0x0E, 0x0A, 0xCA, 0xCB, 0x0B, 0xC9, 0x09,
        0x08, 0xC8, 0xD8, 0x18, 0x19, 0xD9, 0x1B, 0xDB, 0xDA, 0x1A, 0x1E, 0xDE, 0xDF, 0x1F, 0xDD,
        0x1D, 0x1C, 0xDC, 0x14, 0xD4, 0xD5, 0x15, 0xD7, 0x17, 0x16, 0xD6, 0xD2, 0x12, 0x13, 0xD3,
        0x11, 0xD1, 0xD0, 0x10, 0xF0, 0x30, 0x31, 0xF1, 0x33, 0xF3, 0xF2, 0x32, 0x36, 0xF6, 0xF7,
        0x37, 0xF5, 0x35, 0x34, 0xF4, 0x3C, 0xFC, 0xFD, 0x3D, 0xFF, 0x3F, 0x3E, 0xFE, 0xFA, 0x3A,
        0x3B, 0xFB, 0x39, 0xF9, 0xF8, 0x38, 0x28, 0xE8, 0xE9, 0x29, 0xEB, 0x2B, 0x2A, 0xEA, 0xEE,
        0x2E, 0x2F, 0xEF, 0x2D, 0xED, 0xEC, 0x2C, 0xE4, 0x24, 0x25, 0xE5, 0x27, 0xE7, 0xE6, 0x26,
        0x22, 0xE2, 0xE3, 0x23, 0xE1, 0x21, 0x20, 0xE0, 0xA0, 0x60, 0x61, 0xA1, 0x63, 0xA3, 0xA2,
        0x62, 0x66, 0xA6, 0xA7, 0x67, 0xA5, 0x65, 0x64, 0xA4, 0x6C, 0xAC, 0xAD, 0x6D, 0xAF, 0x6F,
        0x6E, 0xAE, 0xAA, 0x6A, 0x6B, 0xAB, 0x69, 0xA9, 0xA8, 0x68, 0x78, 0xB8, 0xB9, 0x79, 0xBB,
        0x7B, 0x7A, 0xBA, 0xBE, 0x7E, 0x7F, 0xBF, 0x7D, 0xBD, 0xBC, 0x7C, 0xB4, 0x74, 0x75, 0xB5,
        0x77, 0xB7, 0xB6, 0x76, 0x72, 0xB2, 0xB3, 0x73, 0xB1, 0x71, 0x70, 0xB0, 0x50, 0x90, 0x91,
        0x51, 0x93, 0x53, 0x52, 0x92, 0x96, 0x56, 0x57, 0x97, 0x55, 0x95, 0x94, 0x54, 0x9C, 0x5C,
        0x5D, 0x9D, 0x5F, 0x9F, 0x9E, 0x5E, 0x5A, 0x9A, 0x9B, 0x5B, 0x99, 0x59, 0x58, 0x98, 0x88,
        0x48, 0x49, 0x89, 0x4B, 0x8B, 0x8A, 0x4A, 0x4E, 0x8E, 0x8F, 0x4F, 0x8D, 0x4D, 0x4C, 0x8C,
        0x44, 0x84, 0x85, 0x45, 0x87, 0x47, 0x46, 0x86, 0x82, 0x42, 0x43, 0x83, 0x41, 0x81, 0x80,
        0x40 ];

function SDI_CRC16(Buffer){
    if (typeof Buffer != 'object' || Buffer.length <= 0) {
        return 0
    }
    var uchCRCHi = 0xFF;
    var uchCRCLo = 0xFF;
    var uIndex = 0;
    var i = 0;
    var usDataLen = Buffer.length;
    while(usDataLen--){
        uIndex = uchCRCHi ^ Buffer.readUInt8(i++);
        uchCRCHi = uchCRCLo ^ auchCRCHi[uIndex];
        uchCRCLo = auchCRCLo[uIndex];
    }
    return (uchCRCLo << 8 | uchCRCHi);
}

function Dec2Hex(num){
    return parseInt(num.toString(10),16);
}

function WriteTimeToBuffer(buf,offset,value){
    var dNow = value;
    var nIdx = offset;
    nIdx = buf.writeUInt8(Dec2Hex(dNow.getFullYear()-2000),nIdx);
    nIdx = buf.writeUInt8(Dec2Hex(dNow.getMonth()+1),nIdx);
    nIdx = buf.writeUInt8(Dec2Hex(dNow.getDate()),nIdx);
    nIdx = buf.writeUInt8(Dec2Hex(dNow.getHours()),nIdx);
    nIdx = buf.writeUInt8(Dec2Hex(dNow.getMinutes()),nIdx);
    nIdx = buf.writeUInt8(Dec2Hex(dNow.getSeconds()),nIdx);
    return nIdx;
}

function WriteTlvBuffer(buf,offset,type,value){
    var nIdx = offset;
    nIdx = buf.writeUInt16BE(type,nIdx);
    nIdx = buf.writeUInt16BE(value.length,nIdx);
    for (var i = 0; i < value.length; i++) {    //拷贝数据
        nIdx = buf.writeUInt8(value.readUInt8(i),nIdx);
    }
    return nIdx;
}

function WriteTlvUInt16BE(buf,offset,type,value){
    var nIdx = offset;
    nIdx = buf.writeUInt16BE(type,nIdx);
    nIdx = buf.writeUInt16BE(2,nIdx);
    nIdx = buf.writeUInt16BE(value,nIdx);
    return nIdx;
}

function sendHeartTime(id,time){
    if (id == null || id == '') {
        return;
    }
    var socket = g_AllClientsOfSocket[id]
    if (socket == null) {
        return
    }
    try
    {
        var nBufMaxLen = 200;
        var buf = new Buffer(nBufMaxLen);
        var nIdx = 0;
        var nLenIdx = 0;
        nIdx = buf.writeUInt16BE(0x7E7E,nIdx);;             //起始标识
        nIdx = buf.writeUInt32BE(0x23235554,nIdx);          //版本
        nIdx = buf.writeUInt16BE(0x4E0B,nIdx);              //功能ID 
        nIdx = buf.writeUInt16BE(0x0000,nIdx);              //包计数
        nIdx = WriteTimeToBuffer(buf,nIdx,new Date());      //当前时间
        nLenIdx = nIdx; nIdx += 2;                          //数据长度占位
        nIdx = WriteTlvBuffer(buf,nIdx,0x0001,Buffer.from(id,'hex')); //开发板序列号 sn 

        nIdx = WriteTlvUInt16BE(buf,nIdx,0xA268,time);      //设置心跳时长

        //---- 数据封装完成，填充Length。Length在当前索引+6个字节，因为还有CRC校验。
        var nDataLen = nIdx + 6;
        buf.writeUInt16BE(nDataLen,nLenIdx);
        //---- 计算CRC填充
        nIdx = WriteTlvUInt16BE(buf,nIdx,0x0007,SDI_CRC16(buf.slice(0,nIdx)));
        var data = buf.slice(0,nIdx); //截取需要发送的数据
        delete buf;
        socket.write(data);
    }
    catch(e){
        logger.error(e);
    }
}

//增加终端 只需要执行一次
//entityAddForYingYan('0011613000FF','heisir',()=>{})