import setup3DAndGetControls from "./3d.js";

const iceServers = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun2.l.google.com:19302"],
  },
];

function currentURLWithParam() {
  return window.location + "?join=";
}

const tapSound = new Howl({
  src: ["assets/sounds/tap.mp3"],
});

const buildSound = new Howl({
  src: ["assets/sounds/placeBuilding.mp3"],
  volume: 0.2,
});

const winSound = new Howl({
  src: ["assets/sounds/win.mp3"],
  volume: 0.6,
});

new Vue({
  el: "#container",
  data: {
    conn: {
      setup: false,
      host: false,
      starting: false,
      offer: "",
      offerCopied: "",
      remoteDescription: "",
      answerDescription: "",
      remoteAnswerDescription: "",
      state: "Connected",
    },
    menuText: "Menu",
    menuOn: "howToPlay",
    move: "",
    build: "",
    draw: null,
    p1: {
      firstWorker: {
        position: [-1, -1],
        created: null,
        id: 0,
      },
      secondWorker: {
        position: [-1, -1],
        created: null,
        id: 1,
      },
    },
    p2: {
      firstWorker: {
        position: [-1, -1],
        created: null,
        id: 2,
      },
      secondWorker: {
        position: [-1, -1],
        created: null,
        id: 3,
      },
    },
    boardSettings: {
      highlightMoves: true,
      highlightBuilds: true,
      highlightPlayers: false,
    },
    volume: 10,
    volumeBuildEnabled: true,
    volumeTapEnabled: true,
    engine: null,
    gameWon: -1,
    game: startGame(),
    setAnswerDescription: null,
    sendMessage: null,
    theyWantReplay: false,
    youWantReplay: false,
    isLocalGame: false,
  },
  created: function () {
    const parsedUrl = new URL(window.location.href);
    const joinCode = null || parsedUrl.searchParams.get("join");

    if (joinCode) {
      this.conn.remoteDescription = joinCode;
      this.joinGame();
    }
  },
  watch: {
    volume: function () {
      Howler.volume(this.volume / 10);
    },
  },
  methods: {
    changeMenuText: function () {
      if (this.menuText == "Menu") {
        this.menuText = "Close";
      } else {
        this.menuText = "Menu";
      }
    },
    setMenu: function (place) {
      this.menuOn = place;
    },
    reloadPage: function () {
      window.location.reload();
    },
    createGame: async function () {
      const v = this;
      const onChannelOpen = () => {
        this.conn.setup = true;

        setTimeout(() => {
          v.setupBoard();
          const colors = Object.values(v.engine.getRandomizedColors()).join();
          this.sendMessage(`${colors}`);
        }, 500);
      };
      const onMessageReceived = (message) =>
        this.handleIncomingMessage(message);

      const {
        localDescription,
        setAnswerDescription,
        sendMessage,
      } = await createPeerConnection({
        iceServers,
        onChannelOpen,
        onMessageReceived,
      });

      this.conn.host = true;
      this.setAnswerDescription = setAnswerDescription;
      this.sendMessage = sendMessage;
      this.conn.offer = currentURLWithParam() + btoa(localDescription);
    },
    createLocalGame: async function () {
      this.conn.host = true;
      this.conn.setup = true;
      this.youWantReplay = true;
      this.theyWantReplay = true;
      this.isLocalGame = true;
      this.sendMessage = (message) => undefined;

      const v = this;
      setTimeout(() => {
        v.setupLocalBoard();
      }, 500);
    },
    copyGameOffer: function () {
      navigator.clipboard.writeText(this.conn.offer);
      this.conn.offerCopied = "(Copied)";
    },
    copyAnswerDescription: function () {
      navigator.clipboard.writeText(this.conn.answerDescription);
      this.conn.offerCopied = "(Copied)";
    },
    joinGame: async function () {
      const onChannelOpen = () => console.log("Connection ready!");
      const onMessageReceived = (message) =>
        this.handleIncomingMessage(message);

      const remoteDescription = atob(this.conn.remoteDescription);
      let { localDescription, sendMessage } = await createPeerConnection({
        remoteDescription,
        iceServers,
        onChannelOpen,
        onMessageReceived,
      });

      this.conn.answerDescription = btoa(localDescription);
      this.sendMessage = sendMessage;
    },
    sendReplayRequest: function () {
      const v = this;
      console.log("Sending replay...");
      v.sendMessage("replay?");
      v.youWantReplay = true;
    },
    acceptReplayRequest: function () {
      console.log("Accepting replay...");
      this.sendMessage("replay!");
      this.replayGame();
    },
    replayGame: function () {
      console.log("replaying game...");

      this.theyWantReplay = this.isLocalGame;
      this.youWantReplay = this.isLocalGame;

      this.engine.clearBuildingsAndWorkers();
      this.game = startGame();
      this.gameWon = -1;

      this.p1 = {
        firstWorker: {
          position: [-1, -1],
          created: null,
          id: 0,
        },
        secondWorker: {
          position: [-1, -1],
          created: null,
          id: 1,
        },
      };

      this.p2 = {
        firstWorker: {
          position: [-1, -1],
          created: null,
          id: 2,
        },
        secondWorker: {
          position: [-1, -1],
          created: null,
          id: 3,
        },
      };
    },
    startGame: function () {
      const v = this;
      v.conn.starting = true;
      const answerDescription = atob(v.conn.remoteAnswerDescription);

      setTimeout(() => {
        v.setAnswerDescription(answerDescription);
      }, 1000);
    },
    handleIncomingMessage: function (msg) {
      const v = this;
      if (msg.length == 0 || msg.length > 50) {
        console.log("Long message received. Ignoring.");
      } else {
        if (v.conn.setup == false) {
          v.conn.setup = true;
          setTimeout(() => {
            v.setupBoard();
            // First message received contains the random colors determined by host player
            v.engine.setRandomizedColors(msg.split(","));
          }, 500);
        } else if (v.gameWon == -1) {
          const myTurnNum = v.conn.host ? 0 : 1;
          const isMyTurn = v.game.playerTurn == myTurnNum;

          if (!isMyTurn) {
            v.playMove({ row: parseInt(msg[0]), column: parseInt(msg[2]) });
          }
        } else if (msg === "replay?") {
          v.theyWantReplay = true;
        } else if (msg === "replay!") {
          v.replayGame();
        }
      }
    },
    setupBoard: function () {
      this.engine = setup3DAndGetControls(this.playMoveIfMyTurn);
    },
    setupLocalBoard: function () {
      this.engine = setup3DAndGetControls(this.playMove);
    },
    drawBuilding: function (row, column) {
      const currentLevelAtPosition = this.game.board[row][column];

      this.engine.addBuilding(currentLevelAtPosition, row, column);
    },
    drawWorkers: function () {
      this.drawWorkerIfMoved(
        this.p1.firstWorker,
        this.game.playerOneFirstWorker,
        false
      );
      this.drawWorkerIfMoved(
        this.p1.secondWorker,
        this.game.playerOneSecondWorker,
        false
      );

      this.drawWorkerIfMoved(
        this.p2.firstWorker,
        this.game.playerTwoFirstWorker,
        true
      );
      this.drawWorkerIfMoved(
        this.p2.secondWorker,
        this.game.playerTwoSecondWorker,
        true
      );
    },
    drawWorkerIfMoved: function (worker, gameWorker, isSecondPlayer) {
      if (
        worker.position[0] != gameWorker[0] ||
        worker.position[1] != gameWorker[1]
      ) {
        const [workerRow, workerColumn] = gameWorker;

        if (worker.created === null) {
          worker.created = true;
          this.engine.addWorker(worker, workerRow, workerColumn);
        }

        this.engine.moveWorkerToPosition(
          worker.id,
          workerRow,
          workerColumn,
          this.game.board[workerRow][workerColumn]
        );
        worker.position[0] = workerRow;
        worker.position[1] = workerColumn;
      }
    },
    highlightLegalMoves: function (moves) {
      for (const positionPair of moves) {
        this.engine.setBoardHighlight(positionPair[0], positionPair[1]);
      }
    },
    playMoveIfMyTurn: function (move) {
      const myTurnNum = this.conn.host ? 0 : 1;
      const isMyTurn = this.game.playerTurn == myTurnNum;
      if (isMyTurn) {
        this.playMove(move);
      }
    },
    playMove: function (move) {
      const { row, column } = move;
      const v = this;
      const myTurnNum = v.conn.host ? 0 : 1;
      const isMyTurn = v.game.playerTurn == myTurnNum;

      if (this.game.state !== v.game.WON) {
        this.game.playPosition(row, column).then(function (isLegalMove) {
          if (isMyTurn && isLegalMove) {
            v.sendMessage(move.row + " " + move.column);
          }

          v.engine.clearBoardHighlights();

          if (v.game.lastBuild != null) {
            v.drawBuilding(v.game.lastBuild[0], v.game.lastBuild[1]);
            v.game.lastBuild = null;
            if (v.volumeBuildEnabled) buildSound.play();
          }

          if (v.game.lastMove != null) {
            v.drawWorkers();
            v.game.lastMove = null;
            v.game.legalMovesForNextTurn = [];
            if (v.volumeTapEnabled) tapSound.play();
          }

          if (
            v.game.state == v.game.CHOOSING_WORKER &&
            v.boardSettings.highlightPlayers
          ) {
            const workerPositions = [];
            if (v.game.playerTurn == 0) {
              workerPositions.push(
                v.game.playerOneFirstWorker,
                v.game.playerOneSecondWorker
              );
            } else {
              workerPositions.push(
                v.game.playerTwoFirstWorker,
                v.game.playerTwoSecondWorker
              );
            }
            v.highlightLegalMoves(workerPositions);
          }

          if (
            v.game.state == v.game.MOVING_WORKER &&
            v.boardSettings.highlightMoves
          ) {
            v.game.listLegalMoves();
            v.highlightLegalMoves(v.game.legalMovesForNextTurn);
            v.game.legalMovesForNextTurn = [];
          }

          if (
            v.game.state == v.game.BUILDING &&
            v.boardSettings.highlightBuilds
          ) {
            v.game.listLegalBuilds();
            v.highlightLegalMoves(v.game.legalBuildsForNextTurn);
            v.game.legalBuildsForNextTurn = [];
          }

          if (v.game.state == v.game.WON && v.gameWon == -1) {
            v.gameWon = v.game.winningPlayer;
            v.engine.winStateRotate(myTurnNum == v.game.winningPlayer);
            winSound.play();
          }
        });
      }
    },
    getNotation: function (row, column) {
      return getNotation(row, column);
    },
  },
});
