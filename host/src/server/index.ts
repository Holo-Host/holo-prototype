import axios from 'axios'
import * as bodyParser from 'body-parser'
import { spawn } from 'child_process'
import * as express from 'express'
import * as fs from 'fs'
import * as path from 'path'

const C = require('./common')

const app = express()

type Hash = string

interface DispatchRequest {
  agentHash: Hash;
  appHash: Hash;
  isSession: boolean;
  rpc: {
    zome: string,
    func: string,
    args: any
  };
}

// Enable CORS
// app.use(function(req, res, next) {
//   res.header("Access-Control-Allow-Origin", "*");
//   res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
//   next();
// })

app.use(bodyParser.json())

app.post('/dispatch', (req, res) => {

  const { agentHash, appHash, isSession, rpc } = req.body

  if (!agentHash || !appHash || !rpc) {
    res.status(400).send('missing required param(s)')
    return
  }

  const handleRequest = () => {
    const port = C.getAgentPort(agentHash)
    const url = switchboardUrl(port, 'switchboard', 'dispatch')
    axios.post(url, rpc)
      .then(data => res.json(data))
      .catch(err => {
        const { response } = err
        console.error(response.data)
        res.status(response.status).send(response.data)
      })
      .catch(err => {
        console.error("Really bad error!! (Probably undefined response")
        res.status(500).send(err)
      })
  }

  if (isAppInstalled(appHash, res)) {
    if (userExists(agentHash)) {
      if (appHash !== C.getUserDnaHash(agentHash)) {
        throw new Error(`App hash does not match installed user app: ${appHash}`)
      } else {
        handleRequest()
      }
    } else {
      createUser(agentHash, appHash).then(() => handleRequest())
    }
  }

})

app.listen(8000)

const switchboardUrl = (port, zome, func) => `http://localhost:${port}/fn/${zome}/${func}`

const isAppInstalled = (appHash: Hash, res) => {
  const hashes = getInstalledApps().map(app => app.hash)
  const found = hashes.find(hash => hash === appHash) !== undefined
  if (!found) {
    const hashesDisplay = hashes.map(h => `- ${h}`).join("\n")
    res.status(404).send(
`App DNA is not registered with this host: ${appHash}.
${hashes.length} Available hashes:
${hashesDisplay}`
    )
    return false
  }
  return true
}

const isAppRegisteredP = (appHash: Hash) =>
  getRegisteredApps()
    .then(entries => {
      const hashes = entries.data.map(app => app.appHash)
      const app = hashes.find(hash => appHash === hash)
      if (!app) {
        const hashesDisplay = hashes.map(h => `- ${h}`).join("\n")
        throw new Error(
`App DNA is not registered with this host: ${appHash}.
${hashes.length} Available hashes:
${hashesDisplay}`
        )
      }
      return app
    })

const userExists = (agentHash: Hash): boolean =>
  C.getInstalledUsers().find(hash => agentHash === hash) !== undefined

const getInstalledApps = () => {
  const base = '/root/.holochain'
  // @ts-ignore: needs 10.10.0^ types for withFileTypes
  const items = fs.readdirSync('/root/.holochain', {withFileTypes: true})
  const dirs = items.filter(item => item.isDirectory() && item.name !== 'switchboard')
  return dirs.map((item) => {
    const { name } = item
    const appDir = path.join(base, name, 'dna.hash')
    const hash = fs.readFileSync(appDir, 'utf8')
    return { name, hash }
  })
}

const getAppByHash = appHash => getInstalledApps().find(app => app.hash === appHash)

const getRegisteredApps = () => {
  return axios.post(switchboardUrl(C.SWITCHBOARD_PORT, 'management', 'getRegisteredApps')).catch(err => {throw new Error('getRegisteredApps: ' + err)})
}

const createUser = (agentHash, appHash): Promise<any> => {
  const app = getAppByHash(appHash)
  return new Promise((fulfill, reject) => {
    if (app) {
      console.log(`spawning agent for app: ${JSON.stringify(app)}`)
      const proc = spawn(`bin/spawn-agent`, [agentHash, app.name])
      proc.stdout.on('data', data => console.log(`spawn: ${data}`))
      proc.on('exit', code => {
        if (code !== 0) {
          reject(`Could not spawn new agent`)
        } else {
          fulfill()
        }
      })
    } else {
      reject(`No app installed with hash: ${appHash}`)
    }
  })
}