"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = __importDefault(require("express"));
var path = __importStar(require("path"));
var ws_1 = require("ws");
var fs_1 = __importDefault(require("fs"));
var crypto_1 = require("crypto");
var app = (0, express_1.default)();
var pre = '';
var intr = undefined;
var clients = [];
var protocol = process.env.PROTOCOL === 'https' ? 'https' : 'http';
var http = require(protocol).Server(app);
var port = process.env.PORT || 8080;
process.on('uncaughtException', function (e) { http.close(); });
process.on('SIGTERM', function () { http.close(); });
app.set('protocol', protocol);
app.set('credentials', app.get('protocol') === 'https' ? {
    key: fs_1.default.readFileSync(process.env.PRIVATE_KEY || './privkey.pem', 'utf8'),
    cert: fs_1.default.readFileSync(process.env.CERTIFICATE || './cert.pem', 'utf8')
} : undefined);
app.set('port', port);
app.set('host', '0.0.0.0');
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: false }));
app.use(express_1.default.static(path.join(__dirname, 'public')));
app.get('/', function (req, res) {
    res.sendFile('index.html', { 'root': './' });
});
http.listen(port, function () {
    console.log("Socket server running at ".concat(protocol, "://0.0.0.0:").concat(port, "/"));
});
var wss = new ws_1.WebSocketServer({
    host: '0.0.0.0',
    server: http,
    path: "/websockets",
});
try {
    wss.on("upgrade", function (request, socket, head) {
        wss.handleUpgrade(request, socket, head, function (websocket) {
            wss.emit("connection", websocket, request);
        });
    });
    wss.on('connection', function (ws) {
        clients.forEach(function (item, index) { if ([2, 3].includes(item.ws.readyState))
            clients.splice(index, 1); });
        ws.on('message', function message(data) {
            var parsed = JSON.parse(data.toString());
            var keys = Object.keys(parsed);
            if (!(keys.includes('do')))
                return;
            if (intr === undefined) {
                startPingPong();
            }
            switch (parsed.do) {
                case 'nick':
                    if (keys.includes('name')) {
                        clients.push({ name: parsed.name, ws: ws, room: '', alive: true, id: 0, usePing: parsed.usePing || false });
                        clients.forEach(function (item) { item.ws.send(JSON.stringify({ do: 'peers', names: clients.map(function (client) { return client.name; }) })); });
                        ws.send(JSON.stringify({ do: 'ping-start' }));
                    }
                    break;
                case 'candidate':
                    var cand = clients.findIndex(function (elem) { return elem.name === parsed.candidateFor; });
                    var tobesent = { do: 'candidate', candidate: parsed.candidate };
                    clients[cand].ws.send(JSON.stringify(tobesent));
                    break;
                case 'peers':
                    ws.send(JSON.stringify({ do: 'peers', names: clients.map(function (client) { if (client.room === '')
                            return client.name; }) }));
                    break;
                // case 'check':
                //   clients.forEach((item)=>{ item.ws.send(JSON.stringify({do: 'peers', names: [clients.map(client => client.name)]}))})
                // break
                case 'play':
                    if (keys.includes('play') && keys.includes('with')) {
                        var room = (0, crypto_1.randomBytes)(8).toString('hex');
                        var iPlay_1 = clients.findIndex(function (elem) { return elem.name === parsed.play; });
                        var iWith = clients.findIndex(function (elem) { return elem.name === parsed.with; });
                        clients[iPlay_1].room = room;
                        clients[iWith].room = room;
                        var sendOffer = { do: 'offer', offeredBy: parsed.with, to: parsed.play, room: room, recievedRemoteDescr: parsed.recievedRemoteDescr || '' };
                        var sendAccept = { do: 'accept', offeredBy: parsed.play, to: parsed.with, room: room };
                        clients[iPlay_1].ws.send(JSON.stringify(sendOffer));
                        clients[iWith].ws.send(JSON.stringify(sendAccept));
                    }
                    break;
                case 'sendTo':
                    if (keys.includes('sendTo') && keys.includes('sentBy') && keys.includes('recievedRemoteDescr')) {
                        var iPlay_2 = clients.findIndex(function (elem) { return elem.name === parsed.sendTo; });
                        var tobesent_1 = { do: 'send', acceptedBy: parsed.sentBy, recievedRemoteDescr: parsed.recievedRemoteDescr };
                        clients[iPlay_2].ws.send(JSON.stringify(tobesent_1));
                    }
                    break;
                case 'answerBy':
                    var iPlay = clients.findIndex(function (elem) { return elem.name === parsed.answerTo; });
                    clients[iPlay].ws.send(JSON.stringify(parsed));
                    break;
                case 'leave':
                    parsed.leave.forEach(function (item) {
                        var index = clients.findIndex(function (elem) { return elem.name === item; });
                        if (index > -1) {
                            if (JSON.stringify(clients[index].ws) !== JSON.stringify(ws)) {
                                clients[index].ws.send(JSON.stringify({ start: 'now' }));
                            }
                            clients.splice(index, 1);
                        }
                    });
                    clients.forEach(function (item) { item.ws.send(JSON.stringify(clients.map(function (client) { return { name: client.name }; }))); });
                    break;
                case 'start':
                    if (keys.includes('with') && keys.includes('from')) {
                        var indexes = clients.filter(function (elem) { return [parsed['with'], parsed['from']].includes(elem.name); });
                        if (indexes.length > 0) {
                            indexes.map(function (client) {
                                if (JSON.stringify(client.ws) !== JSON.stringify(ws)) {
                                    client.room = (0, crypto_1.randomBytes)(8).toString('hex');
                                    client.ws.send(JSON.stringify({ start: 'now' }));
                                }
                            });
                        }
                    }
                case 'move':
                    if (keys.includes('move') && keys.includes('id')) {
                        var index = clients.findIndex(function (elem) { return JSON.stringify(elem.ws) === JSON.stringify(ws); });
                        if (index < 0)
                            return;
                        var room_1 = clients[index].room;
                        ws.send(JSON.stringify({ do: 'confirm', id: parsed['id'], room: room_1 }));
                        var client = clients.filter(function (elem) { return elem.room === room_1; });
                        client.forEach(function (cli) {
                            if (cli.ws !== ws) {
                                cli.ws.send(JSON.stringify({ do: 'move', move: parsed['move'], room: room_1 }));
                            }
                        });
                    }
                    break;
                case 'reconnect':
                    if (keys.includes('name') && keys.includes('id')) {
                        clients.forEach(function (elem, index) { if (elem.name === parsed.name)
                            clients.splice(index, 1); });
                        clients.push({ name: parsed.name, ws: ws, room: parsed.room || '', alive: true, id: parsed.id, usePing: true });
                    }
                    break;
                case 'pong':
                    clients.forEach(function (client, index) { if (client.ws === ws)
                        clients[index].alive = true; });
                    break;
            }
        });
        var startPingPong = function () {
            intr = setInterval(function () {
                clients.forEach(function (item) {
                    if (item.alive && item.usePing) {
                        item.ws.send(JSON.stringify({ do: 'ping' }));
                        item.alive = false;
                    }
                });
            }, 5000);
        };
        ws.on('close', function (ws, code, buff) {
            var index = clients.findIndex(function (elem) { return elem.ws === ws; });
            if (index > -1) {
                clients.splice(index, 1);
            }
        });
    });
}
catch (error) {
    console.log(error.getMessage());
}
// clients.forEach((item, index)=>{item.ws.close()delete(clients[index])})
['/App.css', '/dist/peer.js', '/dist/131.peer.js', '/jsstore.worker.js', '/manifest.json', '/logo192.png', '/favicon.ico'].forEach(function (item) {
    app.get(item, function (req, res) {
        res.sendFile(item, { 'root': './' });
    });
});
var redirectUnmatched = function (_, res) {
    res.redirect('/');
};
app.use(redirectUnmatched); // redirect if nothing else sent a response
exports.default = app;
