let mode, heartbeat
process.on('message', message => {
  if (message.type !== 'call') return
  const reply = value => process.send({ type: 'reply', id: message.id, value })
  if (message.method === 'initialize') {
    mode = message.args[0].systemPrompt
    heartbeat = setInterval(() => process.send({ type: 'heartbeat' }), 20)
    process.send({ type: 'heartbeat' }); reply()
  } else if (message.method === 'prompt') {
    if (mode === 'progress') {
      clearInterval(heartbeat)
      let id = 0
      const progress = setInterval(() => process.send({ type: 'call', id: ++id, method: 'event', args: ['progress', null] }), 30)
      setTimeout(() => { clearInterval(progress); reply() }, 700)
    } else setTimeout(() => reply(), 350)
  } else if (message.method === 'abort') reply()
  else if (message.method === 'snapshot') reply({ version: 1, entries: [], sessionPath: 'fixture' })
})
