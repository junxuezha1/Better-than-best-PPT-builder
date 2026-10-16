process.once('message', input => {
  if (input.kind === 'crash') process.exit(23);
  if (input.kind === 'hang') { while (true) {} }
  const until = Date.now() + (input.busyMs || 0);
  while (Date.now() < until) {}
  process.send({ok: true, value: {pid: process.pid, output: input.output}}, () => process.disconnect());
});
