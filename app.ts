import express, { Express, Request, Response } from 'express'
import WebSocket, { WebSocketServer } from 'ws'
import fs, { readdirSync } from 'fs'
import { randomBytes } from 'crypto'
import cookie, { serialize } from 'cookie'
import { randomUUID } from 'crypto'
import dotenv from 'dotenv'

dotenv.config()

type client = {index: string, ws: WebSocket , name: string, room: string, alive: boolean, id: number, usePing: boolean}

const app: Express = express()
const pre = ''
let intr:NodeJS.Timer|undefined = undefined
const clients: client[] = []
const protocol = process.env.PROTOCOL === 'https' ? 'https' : 'http'
const port = process.env.PORT || '8080'

const privateKey  = process.env.PRIVATE_KEY ? fs.readFileSync(process.env.PRIVATE_KEY, 'utf8') : undefined
const certificate = process.env.CERTIFICATE ? fs.readFileSync(process.env.CERTIFICATE, 'utf8') : undefined
const credentials = privateKey && certificate ? {key: privateKey!, cert: certificate!} : undefined

app.set('protocol', protocol)
app.set('port', port)
app.set('host', '0.0.0.0')

const staticFldr = 'web-build'

const getDirectories = (source:string) =>
  readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)

getDirectories(staticFldr).forEach(fldr => { app.use('/'+fldr, express.static(`${staticFldr}/${fldr}`))})

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.get('/.?*', (req: Request, res: Response) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  const index = cookies.index ? cookies.index : randomUUID()

  res.setHeader('Set-Cookie', serialize('index', index, {
    path: '/',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7 // 1 week
  }));
  res.setHeader('Location', req.headers.referer || '/');

  res.sendFile('index.html', {'root': './web-build'});
});

const server = protocol === 'https' && credentials ? require(protocol).createServer(credentials!, app) : require(protocol).Server(app)

process.on('uncaughtException', (e) => {server.close()})
process.on('SIGTERM', () => {server.close()})

server.listen(port, () => {
  console.log(`⚡️[server]: Server is running at ${protocol}://localhost:${port}`)
})

const wss = new WebSocketServer({
  host: '0.0.0.0',
  server: server,
  path: "/websockets",
})

try {
wss.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (websocket) => {
    const cookies = cookie.parse(request.headers.cookie || '');
    const index = cookies.index ? cookies.index : ''
    const clientIndex = clients.findIndex(item => item.index === index)
    if(clientIndex>=0)
      clients[clientIndex].ws = websocket
      const room = clients.find(client => client.index===index)?.room
      if(room) clients.find(client => client.room === room && client.index !== index)?.ws.send(JSON.stringify({do:'help-me'}))
    else
      clients.push({index: index, name:'', ws:websocket, room:'', alive: true, id: 0, usePing: false})
      wss.emit("connection", websocket, request)
  })
})

wss.on('connection', (ws) => {
  // clients.forEach((item, index)=>{if([2,3].includes(item.ws.readyState)) clients.splice(index,1)})

  ws.on('message', function message(data) {
    const parsed = JSON.parse(data.toString())
    const keys = Object.keys(parsed)

  if(! (keys.includes('do'))) return

  if(intr === undefined) {
    startPingPong()
  }
  
  switch(parsed.do) {

    case 'nick':
      if(keys.includes('name') && keys.includes('index')) {
        const clientIndex = clients.findIndex(client => client.index === parsed.index)
        if(clientIndex===-1){
          clients.push({index: parsed.index, name:parsed.name, ws:ws, room:'', alive: true, id: 0, usePing: parsed.usePing || false})
          ws.send(JSON.stringify({do: 'ping-start'}))
        } else {
          clients[clientIndex].name = parsed.name
          clients[clientIndex].ws = ws
        }
        clients.forEach(item=>{ if(item.room==='') item.ws.send(JSON.stringify ({do: 'peers', peers: clients.filter(client => client.room === '').map(client => {return {name: client.name, index: client.index}})}))})
      }
      break

    case 'candidate':
      const cand = clients.findIndex(elem => elem.name === parsed.candidateFor)
      if(cand===-1) return;
      const tobesent = {do: 'candidate', candidate: parsed.candidate}
      clients[cand].ws.send(JSON.stringify(tobesent))
    break

    case 'peers':
      ws.send(JSON.stringify({do: 'peers', peers: clients.filter(client => client.room === '').map(client => {return {name: client.name, index: client.index}})}))
    break

    // case 'check':
    //   clients.forEach((item)=>{ item.ws.send(JSON.stringify({do: 'peers', names: [clients.map(client => client.name)]}))})
    // break

    case 'play':
    if(keys.includes('play') && keys.includes('with')) {
      const room = randomBytes(8).toString('hex')
      const iPlay = clients.findIndex(elem => elem.index === parsed.play)
      const iWith = clients.findIndex(elem => elem.index === parsed.with)
      if(iPlay === -1 || iWith === -1 ) return;
      clients[iPlay].room = room
      clients[iWith].room = room
      const sendOffer = {do: 'offer', offeredBy: parsed.with, to: parsed.play, room: room, recievedRemoteDescr: parsed.recievedRemoteDescr || ''}
      const sendAccept = {do: 'accept', offeredBy: parsed.play, to: parsed.with, room: room}
      clients[iPlay].ws.send(JSON.stringify(sendOffer))
      clients[iWith].ws.send(JSON.stringify(sendAccept))
    }
    break

    case 'sendTo':
    if(keys.includes('sendTo') && keys.includes('sentBy') && keys.includes('recievedRemoteDescr')) {
      const iPlay = clients.findIndex(elem => elem.name === parsed.sendTo)
      if(iPlay === -1 ) return;
      const tobesent = {do: 'send', acceptedBy: parsed.sentBy, recievedRemoteDescr: parsed.recievedRemoteDescr}
      clients[iPlay].ws.send(JSON.stringify(tobesent))
    }
    break

    case 'answerBy':
      const iPlay = clients.findIndex(elem => elem.name === parsed.answerTo)
      if(iPlay === -1 ) return;
      clients[iPlay].ws.send(JSON.stringify(parsed))
    break

    case 'leave':
      parsed.leave.forEach((item:string) => {
        const index = clients.findIndex(elem => elem.name === item)
        if(index >= 0) {
          if(JSON.stringify(clients[index].ws) !== JSON.stringify(ws)) {
            clients[index].ws.send(JSON.stringify({start:'now'}))
          }
        clients.splice(index, 1)
      }})
        
      clients.forEach((item)=>{ if(item.room==='') item.ws.send(JSON.stringify(clients.map(client => {return {name: client.name}})))})
      break

      case 'start':
        if(keys.includes('with') && keys.includes('from')) {
          const indexes = clients.filter(elem => [parsed['with'], parsed['from']].includes(elem.name))
          if(indexes.length > 0) {
            indexes.map(client => {
            if(JSON.stringify(client.ws) !== JSON.stringify(ws)) {
              client.room = randomBytes(8).toString('hex')
              client.ws.send(JSON.stringify({start:'now'}))
          }})
        }}
        break;

        case 'move':
          if(!keys.includes('move') || !keys.includes('id') || !keys.includes('index'))
          return
          const moveClientIndex = clients.findIndex(client => client.index === parsed.index)
          if(moveClientIndex === -1) return
          const room = clients[moveClientIndex].room
          if(room === '') return
          clients[moveClientIndex].ws = ws
          const partners = clients.filter(client => room === client.room && client.index !== parsed.index)
          if(!partners) return
          ws.send(JSON.stringify({do: 'confirm', id: parsed['id'], room: room}))
          partners.forEach(cli => {
            cli.ws.send(JSON.stringify({do:'move', move: parsed.move, room: room}))
          })
        break

        case 'reconnect':
          if(!keys.includes('index')) return
          const reconnectClientIndex = clients.findIndex(client => client.index = parsed.index)
          if(reconnectClientIndex === -1) return;
          clients[reconnectClientIndex].ws = ws
          break

        case 'pong':
          const clientIndex = clients.findIndex(client => client.ws === ws)
          if(clientIndex === -1) return;
          clients[clientIndex].alive = true
        break

        case 'help-me':
          if(keys.includes('index')) {
            const clientIndex = clients.findIndex(client => client.index === parsed.index)
            if(clientIndex === -1) return
            clients[clientIndex].ws = ws
            const room = clients[clientIndex].room
            clients.find(clnt => room === clnt.room && parsed.index !== clnt.index)?.ws.send(JSON.stringify({do:'help-me'}))
          }
        break

        case 'help-sent':
          const client = clients.find(client => client.ws === ws)
          if(!client) return
          clients.find(clnt => clnt.room === client.room && clnt.index !== client.index)?.ws.send(JSON.stringify({do:'help-sent', board: parsed.board}))
        break
      }
    }
  )  

  const startPingPong = () => {
    intr = setInterval( () => {
      clients.forEach(item=>{
        if(item.alive && item.usePing) {
          item.ws.send(JSON.stringify({do:'ping'}))
          item.alive = false}
        })
      }, 5000)
  }
  
  ws.on('close', (ws:WebSocket, code:number, buff:Buffer) => {
    const index = clients.findIndex(elem => elem.ws === ws)
    if (index > -1) {
       clients.splice(index, 1)
    }})
  })
} catch(error:any) {
  console.log(error.getMessage())
}

export default app
