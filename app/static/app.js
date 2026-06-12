const AVAILABLE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const MIN_CATEGORIES = 5;
const MAX_CATEGORIES = 20;
const MIN_LETTERS = 3;
const queryParams = new URLSearchParams(window.location.search);

const state = {
  room: null,
  playerId: localStorage.getItem("stop.playerId"),
  roomId: localStorage.getItem("stop.roomId"),
  socket: null,
  categories: ["Nome", "CEP", "Animal", "Comida", "Cor", "Objeto"],
  letters: [...AVAILABLE_LETTERS],
  maxRounds: 6,
  roundDurationSeconds: 120,
  reviewCategoryIndex: 0,
  timerInterval: null,
  reviewTimerInterval: null,
  reviewAdvanceKey: null,
  autoStopRound: null,
  lastStatus: null,
  stopModalRound: null,
  saveTimeout: null,
  loadingCount: 0,
  debugPanel: getDebugPanelPreference(),
  devOpsPanelOpen: localStorage.getItem("stop.debugPanelOpen") === "true",
  reconnectAttempts: 0,
  reconnectTimer: null,
  socketClosedByUser: false,
  socketStatus: "offline",
  logFilter: "all",
  lastDevOpsData: null,
};

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  entryView: document.querySelector("#entryView"),
  lobbyView: document.querySelector("#lobbyView"),
  roundView: document.querySelector("#roundView"),
  reviewView: document.querySelector("#reviewView"),
  podiumView: document.querySelector("#podiumView"),
  demoView: document.querySelector("#demoView"),
  playerName: document.querySelector("#playerName"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  roomQrCode: document.querySelector("#roomQrCode"),
  roomQrHint: document.querySelector("#roomQrHint"),
  lobbyRoomCode: document.querySelector("#lobbyRoomCode"),
  copyRoomCodeBtn: document.querySelector("#copyRoomCodeBtn"),
  lobbyRoundNumber: document.querySelector("#lobbyRoundNumber"),
  lobbyPlayerCount: document.querySelector("#lobbyPlayerCount"),
  maxRoundsInput: document.querySelector("#maxRoundsInput"),
  roundDurationInput: document.querySelector("#roundDurationInput"),
  categoriesChips: document.querySelector("#categoriesChips"),
  categoriesLimit: document.querySelector("#categoriesLimit"),
  categoryFeedback: document.querySelector("#categoryFeedback"),
  lettersChips: document.querySelector("#lettersChips"),
  letterFeedback: document.querySelector("#letterFeedback"),
  categoryInput: document.querySelector("#categoryInput"),
  currentLetter: document.querySelector("#currentLetter"),
  reviewLetters: document.querySelectorAll(".reviewLetter"),
  roundCounter: document.querySelector("#roundCounter"),
  roundTimer: document.querySelector("#roundTimer"),
  answersForm: document.querySelector("#answersForm"),
  lobbyPlayersList: document.querySelector("#lobbyPlayersList"),
  participantsLists: document.querySelectorAll(".participantsList"),
  activityLogs: document.querySelectorAll(".activityLog"),
  chatForms: document.querySelectorAll(".chatForm"),
  chatInputs: document.querySelectorAll(".chatInput"),
  votesPanel: document.querySelector("#votesPanel"),
  reviewCategoryTitle: document.querySelector("#reviewCategoryTitle"),
  reviewTimer: document.querySelector("#reviewTimer"),
  podiumTitle: document.querySelector("#podiumTitle"),
  podiumSubtitle: document.querySelector("#podiumSubtitle"),
  podiumSummary: document.querySelector("#podiumSummary"),
  podiumList: document.querySelector("#podiumList"),
  stopModal: document.querySelector("#stopModal"),
  stopMessage: document.querySelector("#stopMessage"),
  leaveRoomModal: document.querySelector("#leaveRoomModal"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  loadingMessage: document.querySelector("#loadingMessage"),
  createRoomBtn: document.querySelector("#createRoomBtn"),
  joinRoomBtn: document.querySelector("#joinRoomBtn"),
  leaveRoomBtn: document.querySelector("#leaveRoomBtn"),
  addCategoryBtn: document.querySelector("#addCategoryBtn"),
  startRoundBtn: document.querySelector("#startRoundBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  newRoundBtn: document.querySelector("#newRoundBtn"),
  shareResultBtn: document.querySelector("#shareResultBtn"),
  playAgainBtn: document.querySelector("#playAgainBtn"),
  backToStartBtn: document.querySelector("#backToStartBtn"),
  demoBackBtn: document.querySelector("#demoBackBtn"),
  closeStopModalBtn: document.querySelector("#closeStopModalBtn"),
  cancelLeaveRoomBtn: document.querySelector("#cancelLeaveRoomBtn"),
  confirmLeaveRoomBtn: document.querySelector("#confirmLeaveRoomBtn"),
  devOpsToggle: document.querySelector("#devOpsToggle"),
  devOpsPanel: document.querySelector("#devOpsPanel"),
  devOpsCloseBtn: document.querySelector("#devOpsCloseBtn"),
  devDsmStatus: document.querySelector("#devDsmStatus"),
  devRedisStatus: document.querySelector("#devRedisStatus"),
  devRedisLatency: document.querySelector("#devRedisLatency"),
  devCacheState: document.querySelector("#devCacheState"),
  devOpsCount: document.querySelector("#devOpsCount"),
  devRefreshBtn: document.querySelector("#devRefreshBtn"),
  devCopyDiagnosticsBtn: document.querySelector("#devCopyDiagnosticsBtn"),
  devForceMissBtn: document.querySelector("#devForceMissBtn"),
  devClearCacheBtn: document.querySelector("#devClearCacheBtn"),
  devDiagnostics: document.querySelector("#devDiagnostics"),
  devEvents: document.querySelector("#devEvents"),
  logFilters: document.querySelectorAll(".logFilter"),
};

elements.createRoomBtn.addEventListener("click", () => runAction(createRoom, false, "Criando sala..."));
elements.joinRoomBtn.addEventListener("click", () => runAction(joinRoom, false, "Entrando na sala..."));
elements.startRoundBtn.addEventListener("click", () => runAction(startRound, false, "Iniciando rodada..."));
elements.stopBtn.addEventListener("click", () => runAction(stopRound, false, "Enviando STOP..."));
elements.newRoundBtn.addEventListener("click", () => runAction(startRound, false, "Preparando rodada..."));
elements.shareResultBtn.addEventListener("click", () => runAction(shareResult, false, "Preparando resultado..."));
elements.playAgainBtn.addEventListener("click", () => runAction(playAgain, false, "Criando nova sala..."));
elements.backToStartBtn.addEventListener("click", goBackToStart);
elements.demoBackBtn.addEventListener("click", () => window.location.assign("/"));
elements.closeStopModalBtn.addEventListener("click", hideStopModal);
elements.leaveRoomBtn.addEventListener("click", showLeaveRoomModal);
elements.cancelLeaveRoomBtn.addEventListener("click", hideLeaveRoomModal);
elements.confirmLeaveRoomBtn.addEventListener("click", () => runAction(leaveRoom, false, "Saindo da sala..."));
elements.copyRoomCodeBtn.addEventListener("click", () => runAction(copyRoomCode, false, "Copiando código..."));
elements.devOpsToggle.addEventListener("click", () => setDevOpsPanelOpen(!state.devOpsPanelOpen));
elements.devOpsCloseBtn.addEventListener("click", () => setDevOpsPanelOpen(false));
elements.devRefreshBtn.addEventListener("click", () => runAction(refreshDevOpsPanel, false, "Atualizando diagnóstico..."));
elements.devCopyDiagnosticsBtn.addEventListener("click", () => runAction(copyDiagnostics, false, "Copiando diagnóstico..."));
elements.devForceMissBtn.addEventListener("click", () => runAction(forceCacheMiss, false, "Forçando cache miss..."));
elements.devClearCacheBtn.addEventListener("click", () => runAction(clearRoomCache, false, "Limpando cache..."));
elements.answersForm.addEventListener("input", scheduleAutoSave);
elements.addCategoryBtn.addEventListener("click", addCategory);
elements.categoryInput.addEventListener("keydown", (event) => addChipOnEnter(event, addCategory));
elements.roomCodeInput.addEventListener("input", updateEntryQrCode);
elements.maxRoundsInput.addEventListener("input", updateMaxRounds);
elements.roundDurationInput.addEventListener("input", updateRoundDuration);
elements.chatForms.forEach((form) => form.addEventListener("submit", sendChatMessage));
elements.logFilters.forEach((button) => {
  button.addEventListener("click", () => {
    state.logFilter = button.dataset.filter || "all";
    renderActivity(state.room);
  });
});

renderConfigChips();
applyRoomCodeFromUrl();
updateEntryQrCode();
initDevOpsPanel();
if (window.location.pathname === "/demo") {
  showView("demo");
} else {
  restoreSavedRoom();
}

async function createRoom() {
  const hostName = requirePlayerName();
  const payload = {
    host_name: hostName,
    categories: state.categories,
    letters: state.letters,
    max_rounds: getMaxRounds(),
    round_duration_seconds: getRoundDurationSeconds(),
  };
  const response = await request("/api/v1/rooms", "POST", payload);
  setPlayer(response.playerId);
  setRoom(response.data);
  connectSocket(response.data.id);
}

async function joinRoom() {
  const roomId = elements.roomCodeInput.value.trim().toUpperCase();
  if (!roomId) {
    alert("Informe o código da sala.");
    return;
  }

  const response = await request(`/api/v1/rooms/${roomId}/players`, "POST", {
    player_name: requirePlayerName(),
  });
  setPlayer(response.playerId);
  setRoom(response.data);
  connectSocket(response.data.id);
}

function applyRoomCodeFromUrl() {
  const roomId = queryParams.get("room");
  if (!roomId) {
    return;
  }
  elements.roomCodeInput.value = roomId.trim().toUpperCase().slice(0, 6);
}

async function restoreSavedRoom() {
  const roomId = queryParams.get("room") || state.roomId;
  if (!roomId || !state.playerId) {
    return;
  }

  showLoading("Restaurando sala...");
  try {
    const response = await request(`/api/v1/rooms/${roomId.trim().toUpperCase()}`);
    if (!response.data.players[state.playerId]) {
      clearSavedSession(false);
      elements.roomCodeInput.value = response.data.id;
      updateEntryQrCode();
      return;
    }
    setRoom(response.data);
    connectSocket(response.data.id);
  } catch {
    clearSavedSession(false);
    render();
  } finally {
    hideLoading();
  }
}

function updateEntryQrCode() {
  const roomId = elements.roomCodeInput.value.trim().toUpperCase();
  const url = new URL(window.location.href);
  if (roomId) {
    url.searchParams.set("room", roomId);
    elements.roomQrHint.textContent = `Escaneie para abrir a sala ${roomId} no celular.`;
  } else {
    url.searchParams.delete("room");
    elements.roomQrHint.textContent = "Digite um código de sala para gerar o QR Code.";
  }
  elements.roomQrCode.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=FFFFFF&bgcolor=052268&margin=12&data=${encodeURIComponent(url.toString())}`;
}

async function saveConfig() {
  if (!state.room) return alert("Crie ou entre em uma sala.");
  const response = await request(`/api/v1/rooms/${state.room.id}`, "PATCH", {
    player_id: state.playerId, // NOVO: Informa o ID do jogador atual para o backend
    categories: state.categories,
    letters: state.letters,
    max_rounds: getMaxRounds(),
    round_duration_seconds: getRoundDurationSeconds(),
  });
  setRoom(response.data);
  return response.data;
}

async function startRound() {
  if (!ensureRoomAndPlayer()) return;
  if (state.room.host_id && state.room.host_id !== state.playerId) {
    alert("Apenas o dono da sala pode começar rodadas.");
    return;
  }
  if (state.room.status === "lobby") {
    await saveConfig();
  }
  const response = await request(`/api/v1/rooms/${state.room.id}/rounds`, "POST", {
    player_id: state.playerId,
  });
  setRoom(response.data);
}

async function submitAnswers(updateUi = true) {
  if (!ensureRoomAndPlayer()) return;
  if (state.room.status !== "playing") return;
  const response = await request(`/api/v1/rooms/${state.room.id}/answers`, "POST", {
    player_id: state.playerId,
    answers: collectAnswers(),
  });
  if (updateUi) {
    setRoom(response.data);
  }
}

async function stopRound(force = false) {
  if (!ensureRoomAndPlayer()) return;
  if (!force && !hasFilledAllAnswers(state.room)) {
    alert("Preencha todos os campos antes de pedir STOP.");
    return;
  }
  const response = await request(`/api/v1/rooms/${state.room.id}/stop`, "POST", {
    player_id: state.playerId,
    answers: collectAnswers(),
    force,
  });
  setRoom(response.data);
}

async function voteAnswer(targetPlayerId, category, valid) {
  if (!ensureRoomAndPlayer()) return;
  const response = await request(`/api/v1/rooms/${state.room.id}/votes`, "POST", {
    voter_id: state.playerId,
    target_player_id: targetPlayerId,
    category,
    valid,
  });
  setRoom(response.data);
}

async function finishRound() {
  if (!ensureRoomAndPlayer()) return;
  const response = await request(`/api/v1/rooms/${state.room.id}/finish`, "POST", {
    player_id: state.playerId,
  });
  setRoom(response.data);
}

function connectSocket(roomId) {
  clearTimeout(state.reconnectTimer);
  state.socketClosedByUser = false;
  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const playerQuery = state.playerId ? `?player_id=${encodeURIComponent(state.playerId)}` : "";
  state.socket = new WebSocket(`${protocol}://${window.location.host}/ws/rooms/${roomId}${playerQuery}`);
  setSocketStatus(state.reconnectAttempts > 0 ? "reconnecting" : "connecting");
  state.socket.onopen = () => {
    state.reconnectAttempts = 0;
    setSocketStatus("online");
  };
  state.socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    setRoom(message.data);
  };
  state.socket.onerror = () => {
    setSocketStatus("reconnecting");
  };
  state.socket.onclose = () => {
    if (state.socketClosedByUser || !state.roomId || !state.playerId) {
      setSocketStatus("offline");
      return;
    }
    scheduleReconnect();
  };
}

function closeSocketIntentionally() {
  clearTimeout(state.reconnectTimer);
  state.socketClosedByUser = true;
  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
    state.socket = null;
  }
  state.socketClosedByUser = false;
  setSocketStatus("offline");
}

function scheduleReconnect() {
  state.reconnectAttempts += 1;
  setSocketStatus("reconnecting");
  const delay = Math.min(1000 * state.reconnectAttempts, 6000);
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(() => {
    if (state.roomId && state.playerId) {
      connectSocket(state.roomId);
    }
  }, delay);
}

function setSocketStatus(status) {
  state.socketStatus = status;
  if (!elements.connectionStatus) {
    return;
  }

  const labels = {
    connecting: "Conectando...",
    online: "Conectado em tempo real",
    reconnecting: "Reconectando...",
    offline: "Tempo real desconectado",
  };

  elements.connectionStatus.textContent = labels[status] || "";
  elements.connectionStatus.className = `connection-status ${status}`;
  elements.connectionStatus.classList.toggle("hidden", status === "offline" || status === "online");
}

async function request(url, method = "GET", body) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  const dsmToken = localStorage.getItem("stop.dsmToken");
  if (dsmToken) {
    options.headers["X-Dsm-Token"] = dsmToken;
  }
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Erro inesperado.");
  }
  return data;
}

function setPlayer(playerId) {
  state.playerId = playerId;
  localStorage.setItem("stop.playerId", playerId);
}

function updateConfigPermissions(room) {
  const isHost = room.host_id === state.playerId;
  
  elements.maxRoundsInput.disabled = !isHost;
  elements.roundDurationInput.disabled = !isHost;
  elements.categoryInput.disabled = !isHost;
  elements.addCategoryBtn.disabled = !isHost;
}

function setRoom(room) {
  const previousStatus = state.room?.status || state.lastStatus;
  state.room = room;
  state.roomId = room.id;
  localStorage.setItem("stop.roomId", room.id);
  if (previousStatus === "playing" && room.status === "voting") {
    state.reviewCategoryIndex = 0;
  }
  if (room.status === "voting") {
    state.reviewCategoryIndex = room.review_category_index || 0;
  }
  render();
  maybeShowStopModal(previousStatus, room);
  state.lastStatus = room.status;
}

function render() {
  const room = state.room;
  elements.currentLetter.textContent = room?.current_letter || "-";
  elements.reviewLetters.forEach((letter) => {
    letter.textContent = room?.current_letter || "-";
  });
  elements.roundCounter.textContent = room ? `${room.round_number || 1}/${room.max_rounds || 6}` : "1/6";

  if (!room) {
    elements.leaveRoomBtn.classList.add("hidden"); // NOVO: Esconde o botão na tela inicial
    showView("entry");
    return;
  }

  elements.leaveRoomBtn.classList.remove("hidden"); // NOVO: Mostra o botão dentro da sala

  state.categories = [...room.categories];
  state.letters = [...room.letters];
  state.maxRounds = room.max_rounds || 6;
  state.roundDurationSeconds = room.round_duration_seconds || 120;
  elements.maxRoundsInput.value = state.maxRounds;
  elements.roundDurationInput.value = state.roundDurationSeconds;
  elements.lobbyRoomCode.textContent = room.id;
  elements.lobbyRoundNumber.textContent = `${room.round_number || 0}/${state.maxRounds}`;
  elements.lobbyPlayerCount.textContent = Object.keys(room.players).length;
  
  renderConfigChips();
  updateConfigPermissions(room); // Mantém a trava visual de permissões do líder

  renderCurrentView(room);
  renderAnswers(room);
  renderPlayers(room, elements.lobbyPlayersList);
  renderParticipants(room);
  renderActivity(room);
  renderVotes(room);
  renderPodium(room);
  updateButtons(room);
  startTimer(room);
  startReviewTimer(room);
  refreshDevOpsPanel(true);
}

function renderCurrentView(room) {
  if (room.winner_id || room.status === "finished") {
    showView("podium");
    return;
  }
  if (room.status === "lobby") {
    showView("lobby");
    return;
  }
  if (room.status === "playing") {
    showView("round");
    return;
  }
  if (room.status === "voting") {
    showView("review");
  }
}

function renderAnswers(room) {
  elements.answersForm.innerHTML = "";
  const currentAnswers = room.answers[state.playerId] || {};

  room.categories.forEach((category) => {
    const label = document.createElement("label");
    label.textContent = category;

    const input = document.createElement("input");
    input.name = category;
    input.placeholder = `Palavra com ${room.current_letter || "a letra sorteada"}`;
    input.value = currentAnswers[category] || "";
    input.disabled = room.status !== "playing";

    label.append(input);
    elements.answersForm.append(label);
  });
}

function renderPlayers(room, container) {
  container.innerHTML = "";
  Object.entries(room.players).forEach(([playerId, name]) => {
    const item = document.createElement("div");
    const online = isPlayerOnline(room, playerId);
    item.className = `player ${online ? "online" : "offline"}`;
    item.innerHTML = `
      <div>
        ${renderPlayerName(name, playerId === room.host_id)}
        <small>${online ? "online" : "offline"}</small>
      </div>
      <span>${room.scores[playerId] || 0} pts</span>
    `;
    container.append(item);
  });
}

function renderParticipants(room) {
  elements.participantsLists.forEach((container) => {
    container.innerHTML = "";
    Object.entries(room.players).forEach(([playerId, name]) => {
      const item = document.createElement("div");
      const online = isPlayerOnline(room, playerId);
      const ready = isPlayerReady(room, playerId);
      const readyLabel = getPlayerProgressLabel(room, playerId, ready);
      item.className = `participant ${online ? "online" : "offline"}`;
      item.innerHTML = `
        <div class="participant-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div>
        <div>
          ${renderPlayerName(name, playerId === room.host_id)}
          <small>${room.scores[playerId] || 0} pts · ${readyLabel} · ${online ? "online" : "offline"}</small>
        </div>
        <span class="ready-check ${ready ? "active" : ""}">✓</span>
      `;
      container.append(item);
    });
  });
}

function isPlayerOnline(room, playerId) {
  return (room.presence?.[playerId] || "offline") === "online";
}

function getPlayerProgressLabel(room, playerId, ready) {
  if (room.status === "playing") {
    return ready ? "respondeu" : "respondendo";
  }
  if (room.status === "voting") {
    return ready ? "votou" : "votando";
  }
  return ready ? "pronto" : "aguardando";
}
function renderPlayerName(name, isHost) {
  const crown = isHost
    ? `
      <svg class="crown-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m3.5 8.5 4.7 3.8L12 5l3.8 7.3 4.7-3.8-1.7 9.5H5.2L3.5 8.5Z" />
        <path d="M5.5 20h13" />
      </svg>
    `
    : "";
  return `<strong class="player-name">${escapeHtml(name)}${crown}</strong>`;
}

function isPlayerReady(room, playerId) {
  if (room.status === "playing") {
    const answers = room.answers[playerId] || {};
    return room.categories.every((category) => (answers[category] || "").trim());
  }

  if (room.status === "voting") {
    const category = room.categories[room.review_category_index || 0] || room.categories[0];
    return Object.keys(room.players)
      .every((targetPlayerId) => {
        const answer = room.answers[targetPlayerId]?.[category] || "";
        if (!answer) {
          return true;
        }
        return Object.prototype.hasOwnProperty.call(room.votes[`${targetPlayerId}:${category}`] || {}, playerId);
      });
  }

  return false;
}

function renderActivity(room) {
  const events = room?.events || [];
  elements.activityLogs.forEach((container) => {
    container.innerHTML = "";
    events
      .filter((event) => state.logFilter === "all" || event.type === state.logFilter)
      .forEach((event) => {
      const item = document.createElement("div");
      item.className = `activity-item ${event.type === "chat" ? "chat" : "system"} ${getEventHighlightClass(event)}`;
      item.innerHTML = `
        <time>${formatEventTime(event.createdAt)}</time>
        <span>${escapeHtml(event.message)}</span>
      `;
      container.append(item);
    });
  });
  elements.logFilters.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.logFilter);
  });
}

function getEventHighlightClass(event) {
  const message = event.message || "";
  if (message.includes("STOP")) return "highlight-stop";
  if (message.includes("iniciada")) return "highlight-start";
  if (message.includes("concluida")) return "highlight-finish";
  if (message.includes("venceu")) return "highlight-winner";
  return "";
}

function formatEventTime(timestamp) {
  if (!timestamp) {
    return "--:--";
  }
  return new Date(timestamp * 1000).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderVotes(room) {
  elements.votesPanel.innerHTML = "";
  if (room.status !== "voting") {
    return;
  }

  state.reviewCategoryIndex = room.review_category_index || 0;
  const category = room.categories[state.reviewCategoryIndex] || room.categories[0];
  elements.reviewCategoryTitle.textContent = `${category} (${state.reviewCategoryIndex + 1}/${room.categories.length})`;

  Object.entries(room.players).forEach(([playerId, playerName]) => {
    const answer = room.answers[playerId]?.[category] || "";
    const voteKey = `${playerId}:${category}`;
    const votes = room.votes[voteKey] || {};
    const currentVote = Object.prototype.hasOwnProperty.call(votes, state.playerId)
      ? votes[state.playerId]
      : votes.system;
    const scoring = getAnswerScorePreview(room, playerId, category);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `vote-row ${currentVote ? "valid" : "invalid"} score-${scoring.points}`;
    row.disabled = !answer;
    row.innerHTML = `
      <span>
        <strong>${escapeHtml(playerName)}</strong>
        <em>${escapeHtml(answer || "Sem resposta")}</em>
        <small>${scoring.points} pts · ${escapeHtml(scoring.reason)}</small>
      </span>
      <b>${currentVote ? "✓" : "×"}</b>
    `;
    row.setAttribute("aria-label", `${currentVote ? "Invalidar" : "Validar"} resposta de ${playerName}`);
    row.addEventListener("click", () => runAction(
      () => voteAnswer(playerId, category, !currentVote),
      false,
      "Registrando voto...",
    ));
    elements.votesPanel.append(row);
  });

  if (hasEveryoneVotedCurrentCategory(room)) {
    scheduleReviewAdvance(room, 250);
  }
}

function getAnswerScorePreview(room, playerId, category) {
  const answer = (room.answers[playerId]?.[category] || "").trim();
  const valid = isAnswerValidByVotes(room, playerId, category, answer);
  if (!answer) {
    return { points: 0, reason: "sem resposta" };
  }
  if (!valid) {
    return { points: 0, reason: "inválida pela votação" };
  }

  const repeated = Object.entries(room.answers)
    .some(([otherPlayerId, answers]) =>
      otherPlayerId !== playerId &&
      (answers[category] || "").trim().toLocaleLowerCase() === answer.toLocaleLowerCase() &&
      isAnswerValidByVotes(room, otherPlayerId, category, answers[category] || ""),
    );

  if (repeated) {
    return { points: 5, reason: "válida, mas repetida" };
  }
  return { points: 10, reason: "válida e única" };
}

function isAnswerValidByVotes(room, playerId, category, answer) {
  if (!String(answer || "").trim()) {
    return false;
  }
  const votes = room.votes[`${playerId}:${category}`] || {};
  const playerVotes = Object.entries(votes).filter(([voter]) => voter !== "system");
  if (playerVotes.length === 0) {
    return votes.system !== false;
  }
  const positiveVotes = playerVotes.filter(([, valid]) => valid).length;
  return positiveVotes >= playerVotes.length / 2;
}

function renderPodium(room) {
  const podium = Object.entries(room.players)
    .map(([playerId, name]) => ({
      playerId,
      name,
      total: room.scores[playerId] || 0,
      round: room.last_round_scores?.[playerId] || 0,
    }))
    .sort((first, second) => second.total - first.total);

  const winnerName = room.winner_id ? room.players[room.winner_id] : null;
  const isGameOver = Boolean(room.winner_id);
  elements.podiumTitle.textContent = winnerName ? `${winnerName} venceu a sala!` : "Pódio da rodada";
  elements.podiumSubtitle.textContent = isGameOver
    ? "A partida terminou. Comece uma nova sala ou volte ao início para entrar em outra."
    : "Rodada concluída. O dono da sala pode iniciar a próxima rodada.";
  elements.podiumSummary.innerHTML = `
    <div><small>Campeão</small><strong>${escapeHtml(winnerName || podium[0]?.name || "-")}</strong></div>
    <div><small>Rodadas jogadas</small><strong>${room.round_number || 0}/${room.max_rounds || state.maxRounds}</strong></div>
    <div><small>Jogadores</small><strong>${podium.length}</strong></div>
  `;
  elements.podiumList.innerHTML = "";

  podium.forEach((player, index) => {
    const item = document.createElement("div");
    item.className = `podium-item position-${index + 1}`;
    item.innerHTML = `
      <span>${index + 1}º</span>
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <small>+${player.round} na rodada / ${player.total} pontos</small>
      </div>
      <b>${player.playerId === room.winner_id ? "Campeão" : `${player.total} pts`}</b>
    `;
    elements.podiumList.append(item);
  });
}

async function shareResult() {
  if (!state.room) return;
  const text = buildResultText(state.room);
  if (navigator.share) {
    await navigator.share({ title: "Resultado Stop Online", text });
    return;
  }
  await copyText(text);
  elements.shareResultBtn.textContent = "Resultado copiado";
  setTimeout(() => {
    elements.shareResultBtn.textContent = "Compartilhar resultado";
  }, 1600);
}

function buildResultText(room) {
  const ranking = Object.entries(room.players)
    .map(([playerId, name]) => ({ name, total: room.scores[playerId] || 0 }))
    .sort((first, second) => second.total - first.total)
    .map((player, index) => `${index + 1}. ${player.name}: ${player.total} pts`)
    .join("\n");
  const winner = room.winner_id ? room.players[room.winner_id] : "sem campeão definido";
  return `Stop Online - sala ${room.id}\nCampeão: ${winner}\nRodadas: ${room.round_number}/${room.max_rounds}\n\n${ranking}`;
}

async function playAgain() {
  closeSocketIntentionally();
  clearSavedSession();
  const playerName = elements.playerName.value.trim() || state.room?.players?.[state.playerId] || "";
  if (playerName) {
    elements.playerName.value = playerName;
  }
  await createRoom();
}

function goBackToStart() {
  closeSocketIntentionally();
  clearSavedSession();
  render();
}

async function sendChatMessage(event) {
  event.preventDefault();
  if (!ensureRoomAndPlayer()) return;

  const input = event.currentTarget.querySelector(".chatInput");
  const message = input.value.trim();
  if (!message) {
    return;
  }

  const response = await request(`/api/v1/rooms/${state.room.id}/chat`, "POST", {
    player_id: state.playerId,
    message,
  });
  input.value = "";
  setRoom(response.data);
}

async function copyRoomCode() {
  if (!state.room?.id) {
    return;
  }
  await copyText(state.room.id);
  elements.copyRoomCodeBtn.classList.add("copied");
  elements.copyRoomCodeBtn.title = "Copiado!";
  setTimeout(() => {
    elements.copyRoomCodeBtn.classList.remove("copied");
    elements.copyRoomCodeBtn.title = "Copiar código";
  }, 1400);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("input");
  input.value = text;
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function showLeaveRoomModal() {
  elements.leaveRoomModal.classList.remove("hidden");
}

function hideLeaveRoomModal() {
  elements.leaveRoomModal.classList.add("hidden");
}

async function leaveRoom() {
  if (!ensureRoomAndPlayer()) return;

  await request(`/api/v1/rooms/${state.room.id}/players/${state.playerId}/leave`, "POST");
  hideLeaveRoomModal();
  closeSocketIntentionally();
  clearSavedSession();
  render();
}

function updateButtons(room) {
  const isHost = room.host_id === state.playerId;
  elements.startRoundBtn.disabled = !isHost || !["lobby", "finished"].includes(room.status);
  elements.startRoundBtn.title = isHost ? "" : "Apenas o dono da sala pode começar rodadas.";
  const canStop = room.status === "playing" && hasFilledAllAnswers(room);
  elements.stopBtn.disabled = !canStop;
  elements.stopBtn.title = canStop ? "" : "Preencha todos os campos antes de pedir STOP.";
  elements.newRoundBtn.disabled = !isHost || Boolean(room.winner_id);
  elements.newRoundBtn.hidden = Boolean(room.winner_id);
  elements.newRoundBtn.title = isHost ? "" : "Apenas o dono da sala pode começar rodadas.";
  elements.shareResultBtn.hidden = room.status !== "finished" && !room.winner_id;
  elements.playAgainBtn.hidden = !room.winner_id;
  elements.backToStartBtn.hidden = room.status !== "finished" && !room.winner_id;
}

function collectAnswers() {
  return Object.fromEntries(new FormData(elements.answersForm).entries());
}

function hasFilledAllAnswers(room) {
  if (!room || !state.playerId) {
    return false;
  }
  const answers = collectAnswers();
  return room.categories.every((category) => (answers[category] || "").trim());
}

function showView(viewName) {
  const views = {
    entry: elements.entryView,
    lobby: elements.lobbyView,
    round: elements.roundView,
    review: elements.reviewView,
    podium: elements.podiumView,
    demo: elements.demoView,
  };
  Object.values(views).forEach((view) => view.classList.remove("active"));
  views[viewName].classList.add("active");
}

function clearSavedSession(clearRoomInput = true) {
  state.room = null;
  state.roomId = null;
  state.lastStatus = null;
  state.stopModalRound = null;
  state.reviewCategoryIndex = 0;
  state.playerId = null;
  localStorage.removeItem("stop.playerId");
  localStorage.removeItem("stop.roomId");
  if (clearRoomInput) {
    elements.roomCodeInput.value = "";
    updateEntryQrCode();
  }
}

function renderConfigChips() {
  renderChips(elements.categoriesChips, state.categories, removeCategory);
  updateCategoriesLimit();
  renderLetterOptions();
}

function updateCategoriesLimit() {
  elements.categoriesLimit.textContent = `${state.categories.length}/${MAX_CATEGORIES} temas`;
}

function showCategoryFeedback(message, type = "warning") {
  elements.categoryFeedback.textContent = message;
  elements.categoryFeedback.className = `category-feedback ${type}`;
}

function clearCategoryFeedback() {
  elements.categoryFeedback.textContent = "";
  elements.categoryFeedback.className = "category-feedback";
}

function showLetterFeedback(message, type = "warning") {
  elements.letterFeedback.textContent = message;
  elements.letterFeedback.className = `letter-feedback ${type}`;
}

function clearLetterFeedback() {
  elements.letterFeedback.textContent = "";
  elements.letterFeedback.className = "letter-feedback";
}

function renderChips(container, values, onAction) {
  container.innerHTML = "";
  if (values.length === 0) {
    container.innerHTML = "<small>Nenhum item cadastrado.</small>";
    return;
  }

  const isHost = state.room?.host_id === state.playerId; // NOVO: Bloqueio do Líder

  values.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<b>${escapeHtml(value)}</b>`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "chip-remove";
    removeButton.disabled = !isHost; // NOVO: Desativa o botão se não for líder
    removeButton.setAttribute("aria-label", `Remover ${value}`);
    removeButton.innerHTML = `
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M4.2 4.2 8 8m0 0 3.8 3.8M8 8l3.8-3.8M8 8l-3.8 3.8" />
      </svg>
    `;
    removeButton.addEventListener("click", () => onAction(value));

    chip.append(removeButton);
    container.append(chip);
  });
}

function addCategory() {
  const category = elements.categoryInput.value.trim();
  if (!category) {
    elements.categoryInput.value = "";
    return;
  }
  const categoryExists = state.categories.some((item) => item.toLocaleLowerCase() === category.toLocaleLowerCase());
  if (categoryExists) {
    showCategoryFeedback(`O tema "${category}" ja existe na sala.`);
    elements.categoryInput.value = "";
    return;
  }
  if (state.categories.length >= MAX_CATEGORIES) {
    showCategoryFeedback(`Limite maximo atingido: ${MAX_CATEGORIES} temas.`);
    elements.categoryInput.value = "";
    return;
  }
  state.categories.push(category);
  elements.categoryInput.value = "";
  renderConfigChips();
  runAction(() => saveConfig(), true); // NOVO: Salva no servidor
  if (state.categories.length === MAX_CATEGORIES) {
    showCategoryFeedback(`Limite maximo atingido: ${MAX_CATEGORIES} temas.`, "success");
    return;
  }
  clearCategoryFeedback();
}

function updateMaxRounds() {
  state.maxRounds = getMaxRounds();
  elements.maxRoundsInput.value = state.maxRounds;
  runAction(() => saveConfig(), true); // NOVO: Salva no servidor
}

function updateRoundDuration() {
  state.roundDurationSeconds = getRoundDurationSeconds();
  elements.roundDurationInput.value = state.roundDurationSeconds;
  runAction(() => saveConfig(), true); // NOVO: Salva no servidor
}

function getMaxRounds() {
  const value = Number.parseInt(elements.maxRoundsInput.value, 10);
  if (Number.isNaN(value)) {
    return 6;
  }
  return Math.min(15, Math.max(6, value));
}

function getRoundDurationSeconds() {
  const value = Number.parseInt(elements.roundDurationInput.value, 10);
  if (Number.isNaN(value)) {
    return 120;
  }
  return Math.min(600, Math.max(60, value));
}

function removeCategory(category) {
  if (state.categories.length <= MIN_CATEGORIES) {
    showCategoryFeedback(`Limite minimo atingido: a sala precisa ter pelo menos ${MIN_CATEGORIES} temas.`);
    return;
  }
  state.categories = state.categories.filter((item) => item !== category);
  renderConfigChips();
  clearCategoryFeedback();
  runAction(() => saveConfig(), true); // NOVO: Salva no servidor
}

function renderLetterOptions() {
  elements.lettersChips.innerHTML = "";
  const isHost = state.room?.host_id === state.playerId; // NOVO: Bloqueio do Líder

  AVAILABLE_LETTERS.forEach((letter) => {
    const isActive = state.letters.includes(letter);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `letter-option${isActive ? " active" : " inactive"}`;
    button.textContent = letter;
    button.disabled = !isHost; // NOVO: Desativa clique se não for líder
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-label", `${isActive ? "Desativar" : "Ativar"} letra ${letter}`);
    button.addEventListener("click", () => toggleLetter(letter));
    elements.lettersChips.append(button);
  });
}

function toggleLetter(letter) {
  if (state.letters.includes(letter)) {
    if (state.letters.length <= MIN_LETTERS) {
      showLetterFeedback(`Limite minimo atingido: selecione pelo menos ${MIN_LETTERS} letras.`);
      return;
    }
    state.letters = state.letters.filter((item) => item !== letter);
  } else {
    state.letters.push(letter);
    state.letters.sort((first, second) => AVAILABLE_LETTERS.indexOf(first) - AVAILABLE_LETTERS.indexOf(second));
  }
  renderConfigChips();
  clearLetterFeedback();
  runAction(() => saveConfig(), true); // NOVO: Salva no servidor
}

function addChipOnEnter(event, callback) {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  callback();
}

function maybeShowStopModal(previousStatus, room) {
  const shouldShow =
    room.status === "voting" &&
    state.stopModalRound !== room.round_number &&
    previousStatus !== "voting";

  if (!shouldShow) {
    return;
  }

  const stoppedBy = room.players[room.stopped_by] || "Tempo esgotado";
  elements.stopMessage.textContent = `${stoppedBy} encerrou a rodada. Todos devem parar de escrever.`;
  elements.stopModal.classList.remove("hidden");
  state.stopModalRound = room.round_number;
}

function hideStopModal() {
  elements.stopModal.classList.add("hidden");
}

function startTimer(room) {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  if (room.status !== "playing") {
    elements.roundTimer.style.transitionDuration = "0s";
    elements.roundTimer.style.width = "100%";
    return;
  }

  const remaining = getRemainingSeconds(room);
  const duration = room.round_duration_seconds || 120;
  const progress = Math.max(0, Math.min(100, (remaining / duration) * 100));
  elements.roundTimer.style.transitionDuration = "0s";
  elements.roundTimer.style.width = `${progress}%`;
  requestAnimationFrame(() => {
    elements.roundTimer.style.transitionDuration = `${remaining}s`;
    elements.roundTimer.style.width = "0%";
  });

  const updateTimer = () => {
    const currentRemaining = getRemainingSeconds(room);
    if (currentRemaining === 0 && state.autoStopRound !== room.round_number) {
      state.autoStopRound = room.round_number;
      runAction(() => stopRound(true), true);
    }
  };

  state.timerInterval = setInterval(updateTimer, 1000);
}

function startReviewTimer(room) {
  if (state.reviewTimerInterval) {
    clearInterval(state.reviewTimerInterval);
    state.reviewTimerInterval = null;
  }

  if (room.status !== "voting") {
    if (elements.reviewTimer) {
      elements.reviewTimer.textContent = "20s";
    }
    return;
  }

  const updateReviewTimer = () => {
    const remaining = getReviewRemainingSeconds(room);
    if (elements.reviewTimer) {
      elements.reviewTimer.textContent = `${remaining}s`;
    }
    if (remaining === 0) {
      scheduleReviewAdvance(room, 0);
    }
  };

  updateReviewTimer();
  state.reviewTimerInterval = setInterval(updateReviewTimer, 1000);
}

function getReviewRemainingSeconds(room) {
  if (!room.review_category_started_at) {
    return 20;
  }
  const elapsed = Math.floor(Date.now() / 1000) - room.review_category_started_at;
  return Math.max(0, 20 - elapsed);
}

function hasEveryoneVotedCurrentCategory(room) {
  const category = room.categories[room.review_category_index || 0];
  if (!category) {
    return false;
  }

  const players = Object.keys(room.players);
  const targetsWithAnswers = players.filter((targetPlayerId) => (room.answers[targetPlayerId]?.[category] || "").trim());
  if (targetsWithAnswers.length === 0) {
    return true;
  }

  return players.every((voterId) =>
    targetsWithAnswers
      .every((targetPlayerId) => Object.prototype.hasOwnProperty.call(room.votes[`${targetPlayerId}:${category}`] || {}, voterId)),
  );
}

function scheduleReviewAdvance(room, delayMs) {
  const advanceKey = `${room.id}:${room.round_number}:${room.review_category_index}`;
  if (state.reviewAdvanceKey === advanceKey) {
    return;
  }
  state.reviewAdvanceKey = advanceKey;

  setTimeout(() => {
    if (!state.room || state.room.status !== "voting") {
      return;
    }
    const currentKey = `${state.room.id}:${state.room.round_number}:${state.room.review_category_index}`;
    if (currentKey !== advanceKey) {
      return;
    }
    runAction(advanceReviewCategory, true);
  }, delayMs);
}

async function advanceReviewCategory() {
  if (!ensureRoomAndPlayer()) return;
  if (state.room.status !== "voting") return;

  const response = await request(`/api/v1/rooms/${state.room.id}/review/next`, "POST", {
    player_id: state.playerId,
    review_category_index: state.room.review_category_index || 0,
  });
  state.reviewAdvanceKey = null;
  setRoom(response.data);
}

function getRemainingSeconds(room) {
  if (!room.round_started_at) {
    return room.round_duration_seconds || 120;
  }
  const elapsed = Math.floor(Date.now() / 1000) - room.round_started_at;
  return Math.max(0, (room.round_duration_seconds || 120) - elapsed);
}

function summarizeVotes(votes = {}) {
  const values = Object.values(votes);
  const validVotes = values.filter(Boolean).length;
  const invalidVotes = values.length - validVotes;
  return `${validVotes} valida(s), ${invalidVotes} invalida(s)`;
}

function scheduleAutoSave() {
  if (!state.room || state.room.status !== "playing") {
    return;
  }

  state.room.answers[state.playerId] = collectAnswers();
  renderParticipants(state.room);
  updateButtons(state.room);
  clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(() => runAction(() => submitAnswers(false), true), 600);
}

async function runAction(action, silent = false, loadingMessage = "Carregando...") {
  if (!silent) {
    showLoading(loadingMessage);
  }
  try {
    await action();
    refreshDevOpsPanel(true);
  } catch (error) {
    if (!silent) {
      alert(error.message);
    }
  } finally {
    if (!silent) {
      hideLoading();
    }
  }
}

function showLoading(message = "Carregando...") {
  state.loadingCount += 1;
  elements.loadingMessage.textContent = message;
  elements.loadingOverlay.classList.remove("hidden");
  document.body.setAttribute("aria-busy", "true");
}

function hideLoading() {
  state.loadingCount = Math.max(0, state.loadingCount - 1);
  if (state.loadingCount > 0) {
    return;
  }
  elements.loadingOverlay.classList.add("hidden");
  document.body.removeAttribute("aria-busy");
}

function initDevOpsPanel() {
  if (!state.debugPanel) {
    elements.devOpsToggle.classList.add("hidden");
    elements.devOpsPanel.classList.add("hidden");
    return;
  }
  localStorage.setItem("stop.debugPanel", "true");
  elements.devOpsToggle.classList.remove("hidden");
  setDevOpsPanelOpen(state.devOpsPanelOpen);
}

async function refreshDevOpsPanel(silent = false) {
  if (!state.debugPanel || !state.devOpsPanelOpen) {
    return;
  }
  try {
    const response = await request("/api/v1/dev/cache/status");
    renderDevOpsPanel(response.data);
  } catch (error) {
    if (!silent) {
      throw error;
    }
  }
}

function setDevOpsPanelOpen(open) {
  state.devOpsPanelOpen = open;
  localStorage.setItem("stop.debugPanelOpen", String(open));
  elements.devOpsPanel.classList.toggle("hidden", !open);
  elements.devOpsToggle.setAttribute("aria-expanded", String(open));
  elements.devOpsToggle.textContent = open ? "Fechar DSM" : "DSM / Cache";
  if (open) {
    refreshDevOpsPanel(true);
  }
}

function getDebugPanelPreference() {
  const debugParam = queryParams.get("debug");
  if (debugParam === "1") {
    localStorage.setItem("stop.debugPanel", "true");
    return true;
  }
  if (debugParam === "0") {
    localStorage.removeItem("stop.debugPanel");
    localStorage.removeItem("stop.debugPanelOpen");
    return false;
  }
  return localStorage.getItem("stop.debugPanel") === "true";
}

function renderDevOpsPanel(data) {
  state.lastDevOpsData = data;
  const lastOperation = data.operations?.[0];
  elements.devDsmStatus.textContent = formatDsmStatus(data.dsm.status);
  elements.devRedisStatus.textContent = formatDsmStatus(data.redis.status);
  elements.devRedisLatency.textContent = data.redis.latencyMs === null ? "-" : `${data.redis.latencyMs}ms`;
  elements.devCacheState.textContent = data.dsm.lastCacheStatus || "-";
  elements.devOpsCount.textContent = String(data.operations?.length || 0);

  elements.devDiagnostics.innerHTML = `
    <small>Diagnóstico</small>
    <div>TTL: ${data.cache.ttl}s | Prefixo: ${escapeHtml(data.cache.prefix)}</div>
    <div>Hit/Miss/Erro: ${data.stats.hits}/${data.stats.misses}/${data.stats.errors}</div>
    <div>Fallbacks: ${data.stats.fallbacks} | Salas na origem local: ${data.cache.originRooms}</div>
    <div>Última operação: ${lastOperation ? escapeHtml(lastOperation.action) : "-"} (${lastOperation ? escapeHtml(lastOperation.result) : "-"})</div>
    <div>Cache ms: ${lastOperation?.cacheMs ?? "-"} | Origem ms: ${lastOperation?.originMs ?? "-"}</div>
    <div>Atualizado em: ${data.dsm.lastUpdatedAt ? new Date(data.dsm.lastUpdatedAt * 1000).toLocaleTimeString("pt-BR") : "-"}</div>
  `;
  renderDevOpsEvents(data);
}

function renderDevOpsEvents(data) {
  const redisEvents = (data.operations || []).slice(0, 6).map((operation) => ({
    source: "Redis",
    type: operation.action,
    status: operation.cacheStatus || operation.result,
    roomId: operation.roomId,
    createdAt: operation.finishedAt,
  }));
  const rabbitEvents = (data.rabbitmq?.events || []).slice(0, 6).map((event) => ({
    source: "RabbitMQ",
    type: event.type,
    status: event.status,
    roomId: event.roomId,
    createdAt: event.createdAt,
  }));
  const events = [...redisEvents, ...rabbitEvents]
    .sort((first, second) => (second.createdAt || 0) - (first.createdAt || 0))
    .slice(0, 10);

  elements.devEvents.innerHTML = `
    <small>Últimos eventos Redis/RabbitMQ</small>
    <div class="devops-events-list">
      ${events.length ? events.map((event) => `
        <div>
          <b>${escapeHtml(event.source)}</b>
          <span>${escapeHtml(event.type)} · ${escapeHtml(event.status)} · ${escapeHtml(event.roomId || "-")}</span>
          <time>${formatEventTime(event.createdAt)}</time>
        </div>
      `).join("") : "<span>Nenhum evento registrado.</span>"}
    </div>
  `;
}

async function copyDiagnostics() {
  if (!state.lastDevOpsData) {
    await refreshDevOpsPanel();
  }
  await copyText(JSON.stringify(state.lastDevOpsData || {}, null, 2));
  elements.devCopyDiagnosticsBtn.textContent = "Copiado";
  setTimeout(() => {
    elements.devCopyDiagnosticsBtn.textContent = "Copiar diagnóstico";
  }, 1400);
}

async function clearRoomCache() {
  const roomQuery = state.room?.id ? `?room_id=${encodeURIComponent(state.room.id)}` : "";
  const response = await request(`/api/v1/dev/cache/clear${roomQuery}`, "POST");
  alert(response.deleted ? "Cache limpo." : "Nenhuma chave de cache removida.");
}

async function forceCacheMiss() {
  if (!state.room?.id) {
    alert("Entre em uma sala para forçar miss.");
    return;
  }
  await request(`/api/v1/dev/cache/force-miss/${state.room.id}`, "POST");
  const response = await request(`/api/v1/rooms/${state.room.id}`);
  setRoom(response.data);
  await refreshDevOpsPanel();
}

function formatDsmStatus(value) {
  return String(value || "-").replaceAll("_", " ");
}

function requirePlayerName() {
  const name = elements.playerName.value.trim();
  if (!name) {
    alert("Informe seu nome.");
    throw new Error("Nome obrigatorio.");
  }
  return name;
}

function ensureRoomAndPlayer() {
  if (!state.room || !state.playerId) {
    alert("Crie ou entre em uma sala primeiro.");
    return false;
  }
  return true;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}