import express, { Express, Request, Response } from 'express'
import WebSocket, { WebSocketServer } from 'ws'
import fs, { readdirSync } from 'fs'
import { randomBytes } from 'crypto'
// import cookie, { serialize } from 'cookie'
import dotenv from 'dotenv'
import https from 'https'
import http from 'http'
import { parse } from 'path'

dotenv.config()

type client = {index: string, ws: WebSocket , name: string, room: string, alive: boolean, id: number, usePing: boolean, used: number}

const app: Express = express()
const pre = ''
// let intr:NodeJS.Timer|undefined = undefined
const clients: Record<string, client> = {}
const protocol = process.env.PROTOCOL === 'https' ? 'https' : 'http'
const host = process.env.HOST || '0.0.0.0'
const port = process.env.PORT || '8080'

const privateKey  = process.env.PRIVATE_KEY ? fs.readFileSync(process.env.PRIVATE_KEY, 'utf8') : undefined
const certificate = process.env.CERTIFICATE ? fs.readFileSync(process.env.CERTIFICATE, 'utf8') : undefined
const credentials = privateKey && certificate ? {key: privateKey!, cert: certificate!} : undefined

const CLIENT_USED = 1000 * 60 * 60 * 24

app.set('protocol', protocol)
app.set('port', port)
app.set('host', host)

const staticFldr = 'web-build'

const getCli = () => {
  return (Object.entries(clients) as Array<[string, client]>).map((item:[string, client]) => item[1])
}

// function str2ab(str: string) {
//   var buf = new ArrayBuffer(str.length * 2); // 2 bytes for each char
//   var bufView = new Uint16Array(buf);
//   for (var i = 0, strLen = str.length; i < strLen; i++) {
//     bufView[i] = str.charCodeAt(i);
//   }
//   return buf;
// }

const getDirectories = (source:string) =>
  readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)

getDirectories(staticFldr).forEach(fldr => { app.use('/'+fldr, express.static(`${staticFldr}/${fldr}`))})

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.get('/.?*', (req: Request, res: Response) => {
  res.sendFile('index.html', {'root': './web-build'});
});

const server = protocol === 'https' && credentials ? https.createServer(credentials!, app) : new http.Server(app)

process.on('uncaughtException', (e) => {server.close()})
process.on('SIGTERM', () => {server.close()})
try {
server.listen(port, () => {
  console.log(`⚡️[server]: Server is running at ${protocol}://${host}:${port}`)
})
} catch(error:any) {
  console.log(error.getMessage())
}

const cleanClients = () => {
  getCli().filter(client => (client.room === '' && client.ws.readyState !== 1) || (client.room.length > 0 && Date.now() - client.used > CLIENT_USED)).forEach(client => delete clients[client.index] )
  // clients.filter(client => client.ws.readyState !== 1).forEach(find => {const index = clients.findIndex(client => client.index === find.index); clients.splice(index,1)})
}

const sendPeers = () => {
  const ready = getCli().filter(client => client.room === '' && client.name !== '' && client.ws.readyState === 1)
  ready.forEach(item => item.ws.send(JSON.stringify ({do: 'peers', peers: ready.map(client => {return {name: client.name, index: client.index}})})))
  return Array.isArray(ready)
}

const isInCli = (index: string | Array<string>) => {
  const arr = Object.keys(clients)
if(!Array.isArray(index)) return arr.includes(index)
  for(const item of index){
    if(!arr.includes(item)) return false
  }
  return true
}

let maxId = 0

const wss = new WebSocketServer({
  host: '0.0.0.0',
  server: server,
  path: "/websockets",
})

try {
// wss.on("upgrade", (request, socket, head) => {
//   wss.handleUpgrade(request, socket, head, (websocket) => {
    // const cookies = cookie.parse(request.headers.cookie || '');
    // const index = cookies.index ? cookies.index : ''
    // if(index!=='')
    //   clients[index].ws = websocket
    // const room = clients[index].room;
    // if(room)
    //   getCli().find((client:client) => client.room === room && client.index !== index)?.ws.send(JSON.stringify({do:'help-me'}))
    // else
    //   clients[index] = {index: index, name:'', ws:websocket, room:'', alive: true, id: 0, usePing: false, used: Date.now()}
//       wss.emit("connection", websocket, request)
//   })
// })

wss.on('connection', (ws) => {
  // clients.forEach((item, index)=>{if([2,3].includes(item.ws.readyState)) clients.splice(index,1)})

  ws.on('message', function message(data) {
    const parsed = JSON.parse(data.toString())
    const keys = Object.keys(parsed)

  if(! (keys.includes('do'))) return

  // if(intr === undefined) {
  //   startPingPong()
  // }
  
  if(!keys.includes('index')) return
  if(!isInCli(parsed.index))
    if(['help-me', 'nick', 'reset'].includes(parsed.do)) {
      clients[parsed.index] = {index: parsed.index, name:'', ws:ws, room: keys.includes('room') ? parsed.room : '', alive: true, id: maxId++, usePing: false, used: Date.now()}
      if(parsed.do === 'reset' && parsed.room !== '') {
        const found =  getCli().find(clnt => parsed.room === clnt.room && clnt.index && clnt.index !== parsed.index && clnt.ws.readyState === 1)
        found?.ws.send(JSON.stringify({do:'help-me', index: found.index, to: parsed.index}))
      }
    }
    else {
      cleanClients()
      sendPeers()
      return
    }
  else
    if(clients[parsed.index].ws.readyState > 1)
      clients[parsed.index].ws = ws
    else {
      if(clients[parsed.index].ws !== ws)
        ws.send(JSON.stringify(({do:'reset', room: clients[parsed.index].room})))
    }
  switch(parsed.do) {

    case 'nick':
      cleanClients()
      if(keys.includes('name')) {
        clients[parsed.index].name = parsed.name
        clients[parsed.index].alive = true
        clients[parsed.index].usePing = parsed.usePing || false
        clients[parsed.index].used = Date.now()
        const room = clients[parsed.index].room
        if(room!=='') {
          clients[parsed.index].room = ''
          const clientsInRoom = getCli().filter(client => client.room === room)
          if(clientsInRoom.length === 1) {
            const indexOfLast = getCli().findIndex(client => client.room === room)
            clients[indexOfLast].room = ''
          }
        }
      }
      if(!sendPeers()) {
        ws.send(JSON.stringify({peers: {index: parsed.index, name: parsed.name}}))
      }
      break

    case 'candidate':
      if(!keys.includes('candidateFor')) return
      const cand = getCli().findIndex(elem => elem.name === parsed.candidateFor)
      if(cand===-1) return;
      const tobesent = {do: 'candidate', candidate: parsed.candidate}
      clients[cand].ws.send(JSON.stringify(tobesent))
    break

    case 'peers':
      cleanClients()
      sendPeers()
    break

    case 'check':
      ws.send(JSON.stringify({do: 'peers', peers: getCli().filter(client => client.room === '' && client.ws.readyState === 1 && client.name !== '').map((client => {return {name: client.name, index: client.index}}))}))
    break

    case 'play':
    if(keys.includes('play') && keys.includes('with')) {
      const room = randomBytes(8).toString('hex')
      if( !isInCli([parsed.play, parsed.with]) ) return;
      clients[parsed.play].room = room
      clients[parsed.with].room = room
      const sendOffer = {do: 'offer', offeredBy: parsed.with, to: parsed.play, room: room, recievedRemoteDescr: keys.includes('recievedRemoteDescr') ? parsed.recievedRemoteDescr || '' : ''}
      const sendAccept = {do: 'accept', offeredBy: parsed.play, to: parsed.with, room: room}
      clients[parsed.play].ws.send(JSON.stringify(sendOffer))
      clients[parsed.with].ws.send(JSON.stringify(sendAccept))
      sendPeers()
    }
    break

    case 'sendTo':
    if(keys.includes('sendTo') && keys.includes('sentBy') && keys.includes('recievedRemoteDescr')) {
      const iPlay = getCli().findIndex(elem => elem.name === parsed.sendTo)
      if(iPlay === -1 ) return;
      const tobesent = {do: 'send', acceptedBy: parsed.sentBy, recievedRemoteDescr: parsed.recievedRemoteDescr}
      clients[iPlay].ws.send(JSON.stringify(tobesent))
    }
    break

    case 'answerBy':
      if(!keys.includes('answerTo')) return
      const iPlay = getCli().findIndex(elem => elem.name === parsed.answerTo)
      if(iPlay === -1 ) return;
      clients[iPlay].ws.send(JSON.stringify(parsed))
    break

    case 'leave':
      clients[parsed.index].room = ''
      cleanClients()
      sendPeers()
    break

      case 'start':
        if(keys.includes('with') && keys.includes('from')) {
          const indexes = getCli().filter(elem => [parsed['with'], parsed['from']].includes(elem.name))
          if(indexes.length > 0) {
            indexes.map(client => {
            if(JSON.stringify(client.ws) !== JSON.stringify(ws)) {
              client.room = randomBytes(8).toString('hex')
              client.ws.send(JSON.stringify({start:'now'}))
          }})
        }}
        break;

        case 'move':
          if(!keys.includes('move') || !keys.includes('id')) return
          const room = clients[parsed.index].room
          if(room === '') return
          const partners = getCli().filter(client => room === client.room && client.index !== parsed.index)
          if(!partners) return
          clients[parsed.index].ws.send(JSON.stringify({do: 'confirm', id: parsed.id, room: room}))
          partners.forEach(cli => {
            cli.ws.send(JSON.stringify({do:'move', move: parsed.move, room: room}))
          })
        break

        case 'replace-phalanx':
          if(!keys.includes('figure')) return
          getCli().filter(client => client.room === clients[parsed.index].room && client.index !== clients[parsed.index].index).forEach(cli => cli.ws.send(JSON.stringify({do:'replace-phalanx', figure: parsed.figure})))
          break

        case 'reconnect':
          break

        case 'pong':
          clients[parsed.index].alive = true
        break

        case 'help-me':
          if(!keys.includes('to') || !isInCli(parsed.to) || clients[parsed.to].room !== clients[parsed.index].room){ sendPeers(); return } 
          getCli().find(clnt => clients[parsed.index].room === clnt.room && parsed.index !== clnt.index && clnt.ws.readyState === 1)?.ws.send(JSON.stringify({do:'help-me', index: parsed.to, to: parsed.index}))
        break

        case 'help-sent':
          if(!keys.includes('to') || !keys.includes('start') || !keys.includes('board') || !keys.includes('lastMove') || !keys.includes('playing')) return
          clients[parsed.to].ws.send(JSON.stringify({do:'help-sent', start: parsed.start, board: parsed.board, lastMove: parsed.lastMove, playing: parsed.playing}))
        break
      }
    }
  )  

  // const startPingPong = () => {
  //   intr = setInterval( () => {
  //     getCli().forEach(client=> {
  //       if(client.alive && client.usePing) {
  //         client.ws.send(JSON.stringify({do:'ping'}))
  //         client.alive = false}
  //       })
  //     }, 5000)
  //     // clients.forEach(item=>{
  //     //   if(item.alive && item.usePing) {
  //     //     item.ws.send(JSON.stringify({do:'ping'}))
  //     //     item.alive = false}
  //     //   })
  //     // }, 5000)
  // }
  
  // ws.on('close', (ws:WebSocket, code:number, buff:Buffer) => {
  //   const index = clients.findIndex(elem => elem.ws === ws)
  //   if (index > -1) {
  //      clients.splice(index, 1)
  //   }})
  })
} catch(error:any) {
  console.log(error.getMessage())
}

export default app
