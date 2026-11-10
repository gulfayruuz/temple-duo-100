/* PeerJS находит второго игрока. Игровой мир рассчитывает создатель комнаты. */
(() => {
  const menu = byId('online-menu');
  const invite = byId('invite');
  const protocol = 'temple-duo-online-v1';
  const roomPattern = /^temple-[a-f0-9]{32}$/;
  const requestedRoom = new URL(location.href).searchParams.get('room') || '';
  let peer;
  let connection;
  let attempt = 0;
  let timeout;
  let lastInput = 0;
  let library;
  let roomUrl = '';
  let hiddenTick = 0;
  let hiddenRemainder = 0;

  function message(text) {
    byId('online-status').textContent = text;
    byId('online-banner').textContent = text;
    byId('online-strip').hidden = !text || onlineRole === 'local';
    byId('quick-invite').hidden = onlineRole !== 'host' || !roomUrl || onlineReady;
  }

  function configureRole(role) {
    onlineRole = role;
    onlineReady = false;
    remoteControls = {left: false, right: false, jump: false};
    clearKeys();
    byId('levels').disabled = role === 'guest';
    byId('restart').disabled = role === 'guest';
    byId('continue').hidden = role === 'guest';
    byId('leave-room').hidden = role === 'local';
    byId('resume-room').hidden = role !== 'host';
    byId('create-room').hidden = role !== 'local';
    byId('join-room').hidden = role !== 'local' || !roomPattern.test(requestedRoom);
    byId('invite-box').hidden = role !== 'host' || !roomUrl;
  }

  function stopRoom(text) {
    const wasGuest = onlineRole === 'guest';
    attempt++;
    clearTimeout(timeout);
    const previousPeer = peer;
    const previousConnection = connection;
    peer = undefined;
    connection = undefined;
    roomUrl = '';
    configureRole('local');
    previousConnection?.close();
    previousPeer?.destroy();
    if (wasGuest) startLevel(level.number);
    message(text);
  }

  function showMenu() {
    clearKeys();
    if (!menu.open) menu.showModal();
  }

  function loadPeerLibrary() {
    if (window.Peer) return Promise.resolve(window.Peer);
    library ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
      script.onload = () => window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS unavailable'));
      script.onerror = reject;
      document.head.append(script);
    }).catch((error) => {
      library = undefined;
      throw error;
    });
    return library;
  }

  function send(packet) {
    if (!onlineReady || !connection?.open) return;
    // Пропускаем кадр, если предыдущие сообщения ещё стоят в очереди.
    if (packet.type === 'state' && connection.dataChannel?.bufferedAmount > 16000) return;
    connection.send(packet);
  }

  function bindConnection(link, activeAttempt) {
    if (connection || link.label !== protocol) {
      link.close();
      return;
    }
    connection = link;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (connection !== link || onlineReady) return;
      disconnected('Подключение не установилось. Оставьте игру открытой у создателя и попробуйте снова.');
      link.close();
    }, 30000);

    function disconnected(reason) {
      if (connection !== link || activeAttempt !== attempt) return;
      clearTimeout(timeout);
      connection = undefined;
      if (onlineRole === 'guest') {
        stopRoom(typeof reason === 'string' ? reason
          : 'Связь потеряна. Откройте приглашение снова, пока у создателя открыта игра.');
      } else {
        onlineReady = false;
        remoteControls = {left: false, right: false, jump: false};
        clearKeys();
        message(typeof reason === 'string' ? reason
          : 'Партнёр отключился. Отправьте ему ту же ссылку, чтобы продолжить.');
      }
      showMenu();
    }

    link.on('close', disconnected);
    link.on('error', disconnected);
    link.on('open', () => {
      if (connection !== link || activeAttempt !== attempt) return;
      clearTimeout(timeout);
      lastInput = performance.now();
      onlineReady = true;
      if (menu.open) menu.close();
      message(onlineRole === 'host' ? 'Онлайн · Вы Огонь. Управление стрелками.'
        : 'Онлайн · Вы Вода. Управление A, W, D. Уровень выбирает Огонь.');
      if (onlineRole === 'host') send({type: 'state', state: onlineSnapshot()});
    });
    link.on('data', (packet) => {
      if (connection !== link || !onlineReady || !packet || typeof packet !== 'object') return;
      if (onlineRole === 'host' && packet.type === 'input') {
        const now = performance.now();
        lastInput = now;
        remoteControls.left = packet.left === true;
        remoteControls.right = packet.right === true;
        remoteControls.jump ||= packet.jump === true;
        // В фоновой вкладке браузер останавливает requestAnimationFrame.
        // Пока гость активен, его пакеты поддерживают симуляцию хозяина.
        if (document.hidden && status === 'playing' && !menu.open &&
            !levelMenu.open && !settingsMenu.open) {
          hiddenRemainder += hiddenTick ? Math.min(80, now - hiddenTick) : 0;
          hiddenTick = now;
          while (hiddenRemainder >= FRAME_TIME && status === 'playing') {
            hiddenRemainder -= FRAME_TIME;
            updateGame();
          }
          send({type: 'state', state: onlineSnapshot()});
        } else {
          hiddenTick = 0;
          hiddenRemainder = 0;
        }
      }
      if (onlineRole === 'guest' && packet.type === 'state') {
        const state = packet.state;
        if (state && Number.isInteger(state.number) && state.number >= 1 &&
            state.number <= LEVEL_COUNT && state.players?.length === 2) applyOnlineSnapshot(state);
      }
    });
  }

  async function startRoom(role) {
    if (onlineRole !== 'local') return;
    if (location.protocol === 'file:') {
      message('Для комнаты откройте игру на GitHub Pages: локальная ссылка не откроется на другом компьютере.');
      return;
    }
    const activeAttempt = ++attempt;
    configureRole(role);
    message('Подключаемся к сервису комнат…');
    const fail = (text) => {
      if (activeAttempt !== attempt) return;
      stopRoom(text);
      showMenu();
    };
    timeout = setTimeout(() => fail('Подключение не удалось. Попробуйте ещё раз.'), 15000);
    try {
      const Peer = await loadPeerLibrary();
      if (activeAttempt !== attempt) return;
      const id = 'temple-' + Array.from(crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, '0')).join('');
      peer = role === 'host' ? new Peer(id, {secure: true}) : new Peer({secure: true});
      peer.on('open', () => {
        if (activeAttempt !== attempt) return;
        if (role === 'guest') {
          bindConnection(peer.connect(requestedRoom, {label: protocol, serialization: 'json', reliable: true}), activeAttempt);
        } else {
          clearTimeout(timeout);
          const url = new URL(location.href);
          url.searchParams.set('room', id);
          url.hash = '';
          roomUrl = url.href;
          invite.value = roomUrl;
          byId('invite-box').hidden = false;
          message('Огонь · Ожидаем Воду. Скопируйте приглашение и оставьте вкладку открытой.');
          if (menu.open) menu.close();
        }
      });
      peer.on('connection', (link) => {
        if (role === 'host' && activeAttempt === attempt) bindConnection(link, activeAttempt);
        else link.close();
      });
      peer.on('error', (error) => {
        if (onlineReady && error.type === 'network') return;
        fail(error.type === 'peer-unavailable'
          ? 'Комната недоступна. Попросите создателя открыть игру и прислать актуальную ссылку.'
          : 'Сервис комнат недоступен или сеть заблокировала подключение.');
      });
      peer.on('disconnected', () => {
        if (activeAttempt === attempt && !peer.destroyed) peer.reconnect();
      });
    } catch {
      fail('Не удалось загрузить онлайн-режим. Проверьте интернет и откройте опубликованную игру.');
    }
  }

  byId('online').onclick = showMenu;
  byId('create-room').onclick = () => startRoom('host');
  byId('join-room').onclick = () => startRoom('guest');
  byId('resume-room').onclick = () => menu.close();
  byId('leave-room').onclick = () => stopRoom('Режим на одной клавиатуре включён.');
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(roomUrl);
      message('Огонь · Ожидаем Воду. Ссылка скопирована, отправьте её второму игроку.');
      if (menu.open) menu.close();
    } catch {
      showMenu();
      invite.select();
      message('Скопируйте выделенную ссылку клавишами Ctrl+C.');
    }
  }
  byId('copy-invite').onclick = copyInvite;
  byId('quick-invite').onclick = copyInvite;
  configureRole('local');
  if (roomPattern.test(requestedRoom)) {
    showMenu();
    startRoom('guest');
  }

  setInterval(() => {
    if (!onlineReady) return;
    if (onlineRole === 'host') {
      if (performance.now() - lastInput > 400) {
        remoteControls = {left: false, right: false, jump: false};
      }
      send({type: 'state', state: onlineSnapshot()});
    } else {
      const keys = controls[1];
      const arrows = controls[0];
      send({type: 'input', left: heldKeys.has(keys.left) || heldKeys.has(arrows.left),
        right: heldKeys.has(keys.right) || heldKeys.has(arrows.right),
        jump: pressedKeys.has(keys.jump) || pressedKeys.has(arrows.jump)});
      pressedKeys.clear();
    }
  }, 33);
})();
