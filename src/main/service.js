// Independent household runtime: Node + local engine, with no graphical login.
let retry;
async function start({ port = 4000, engine = true, lanPort = process.env.ASPEN_LAN_PORT ? Number(process.env.ASPEN_LAN_PORT) : null } = {}) {
  if (!require('./service-key').provider())
    throw new Error('ASPEN_KEY_FILE must reference a protected 32-byte service credential');
  const release = await require('./profile-lock').acquire();
  let lan;
  try {
    require('./backup').recover();
    require('./durable-json').migrateKnownRecords();
    require('./vault').get().sweep();
    const store = require('./store');
    const keys = require('./apikeys');
    require('./enrollment').initialize();
    if (!keys.listKeys().some((k) => k.owner)) keys.createKey('Household owner', { owner: true });
    // Start serving before inference loads, so setup and vault remain available.
    const gateway = require('./gateway');
    await gateway.start({ port, household: true });
    lan = lanPort == null ? null : await require('./lan-transport').start({ port: lanPort, upstreamPort: gateway.getPort() });
    require('./chat-service').snapshot();
    const runtimeAbort = new AbortController();
    let boot;
    if (engine) {
      let loading = false;
      retry = () => {
        if (loading || runtimeAbort.signal.aborted) return;
        loading = true;
        boot = require('./appliance-model')
        .ready({ signal: runtimeAbort.signal })
        .then(async () => {
          if (runtimeAbort.signal.aborted) return;
          require('./always-on').init({
            runAgent: require('./chat-service').run,
            getActiveModel: () => store.get('activeModel'),
          });
          await require('./connectors').reconnectSaved();
        })
        .catch((error) => console.error('Local model needs attention:', error.message))
        .finally(() => { loading = false; });
      };
      retry();
    }
    return {
      port: gateway.getPort(),
      lanPort: lan?.port,
      async stop() {
        runtimeAbort.abort();
        retry = null;
        require('./chat-service').stopAll();
        await Promise.all([require('./always-on').shutdown(), lan?.stop(), gateway.stop(), boot]);
        await require('./mcp-client').disconnectAll();
        await release();
      },
    };
  } catch (error) {
    await lan?.stop();
    await require('./gateway').stop();
    await release();
    throw error;
  }
}
if (require.main === module) {
  start({ port: Number(process.env.ASPEN_PORT || 4000) })
    .then((service) => {
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        const deadline = setTimeout(() => process.exit(1), 8000).unref();
        await service.stop();
        clearTimeout(deadline);
        process.exit(0);
      };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      // Fail closed: a corrupted in-memory process is restarted by systemd.
      process.once('uncaughtException', (error) => {
        console.error(error.message);
        process.exit(1);
      });
      process.once('unhandledRejection', (error) => {
        console.error(error?.message || 'Unhandled runtime failure');
        process.exit(1);
      });
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { start, retryModel: () => {
  if (!retry) throw new Error('Model setup is not available in this runtime');
  retry(); return { success: true };
} };
