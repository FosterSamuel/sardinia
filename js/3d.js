export default function setup3DAndGetControls(clickHandler) {
  class ResourceTracker {
    constructor() {
      this.resources = new Set();
    }

    track(resource) {
      if (resource.dispose || resource instanceof THREE.Object3D) {
        this.resources.add(resource);
      }
      return resource;
    }

    untrack(resource) {
      this.resources.delete(resource);
    }

    dispose() {
      for (const resource of this.resources) {
        if (resource instanceof THREE.Object3D) {
          if (resource.parent) {
            resource.parent.remove(resource);
          }
        }

        if (resource.dispose) {
          resource.dispose();
        }
      }
      this.resources.clear();
    }
  }

  class GPUPickHelper {
    constructor() {
      // create a 1x1 pixel render target
      this.pickingTexture = new THREE.WebGLRenderTarget(1, 1);
      this.pixelBuffer = new Uint8Array(4);
      this.pickedObject = null;
      this.pickedObjectID = null;
      this.pickedObjectSavedColor = 0;
      this.highlightAsResultOfPick = [];
    }
    pick(cssPosition, scene, camera) {
      const { pickingTexture, pixelBuffer } = this;

      // restore the color if there is a picked object
      if (this.pickedObject) {
        this.pickedObject.material.emissive.setHex(this.pickedObjectSavedColor);

        this.pickedObject = undefined;
        this.pickedObjectID = null;

        for (const building of this.highlightAsResultOfPick) {
          building.material.emissive.setHex(this.pickedObjectSavedColor);
        }

        this.highlightAsResultOfPick = [];
        this.pickedObjectSavedColor = null;
      }

      // set the view offset to represent just a single pixel under the mouse
      const pixelRatio = renderer.getPixelRatio();
      camera.setViewOffset(
        renderer.getContext().drawingBufferWidth, // full width
        renderer.getContext().drawingBufferHeight, // full top
        (cssPosition.x * pixelRatio) | 0, // rect x
        (cssPosition.y * pixelRatio) | 0, // rect y
        1, // rect width
        1 // rect height
      );
      // render the scene
      renderer.setRenderTarget(pickingTexture);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      // clear the view offset so rendering returns to normal
      camera.clearViewOffset();
      //read the pixel
      renderer.readRenderTargetPixels(
        pickingTexture,
        0, // x
        0, // y
        1, // width
        1, // height
        pixelBuffer
      );

      const id =
        (pixelBuffer[0] << 16) | (pixelBuffer[1] << 8) | pixelBuffer[2];

      const intersectedObject = idToObject[id];

      if (intersectedObject) {
        // pick the first object. It's the closest one
        this.pickedObject = intersectedObject;
        this.pickedObjectID = id;
        this.highlightAsResultOfPick = idToIntersectedBuildings[id];

        for (const building of this.highlightAsResultOfPick) {
          building.material.emissive.setHex(0xffff00);
        }

        // save its color
        this.pickedObjectSavedColor = this.pickedObject.material.emissive.getHex();
        // set its emissive color to flashing red/yellow
        this.pickedObject.material.emissive.setHex(0xffff00);
      }
      return this.pickedObject;
    }
  }

  // Canvas + Renderer
  const canvas = document.getElementById("sardinia-canvas");
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 2.3;
  renderer.shadowMap.enabled = true;

  let renderRequested = false;

  // Camera
  const fov = 75;
  const aspectRatio = 2;
  const near = 0.1;
  const far = 10005;
  const camera = new THREE.PerspectiveCamera(fov, aspectRatio, near, far);
  camera.position.z = 70;
  camera.position.y = 70;
  camera.lookAt(0, 0, 0);

  // Camera controls
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.update();
  let tweenRunning = false;

  // Scene + Picking scene
  const scene = new THREE.Scene();
  const pickingScene = new THREE.Scene();
  pickingScene.background = new THREE.Color(0);

  // Lights
  let orbitingLight;
  const skyColor = new THREE.Color(0xffceb1);
  const groundColor = new THREE.Color(0x000000);

  // Resources
  const resourceTracker = new ResourceTracker();
  const track = resourceTracker.track.bind(resourceTracker);

  // Board
  const gapBetweenSquares = 0.5;

  const boardHeight = 2;
  const boardWidth = 80 + 4 * gapBetweenSquares - 4;

  const boardOriginX = -1 * (boardWidth / 2);
  const boardOriginZ = boardOriginX;

  const boardSquareGeometry = new THREE.BoxBufferGeometry(
    16,
    boardHeight * 2,
    16
  );

  // Picking reference
  const pickHelper = new GPUPickHelper();
  const pickPosition = { x: 0, y: 0 };
  let picked;
  clearPickPosition();

  const idToObject = {};
  const idToIntersectedBuildings = {};
  const idToPickingCube = {};
  const colorForId = {};
  const boardToId = { 0: {}, 1: {}, 2: {}, 3: {}, 4: {} };
  let highlightedBoardSquares = [];

  // Buildings
  const randomBuildingColors = [
    0x3d9cff /* blue */,
    0xffc2f8 /* pink */,
    0xffe29e /* tan */,
    0xfff9d4 /* off white */,
    0xb8f3ff /* pale blue */,
    0xa1ffc3 /* pale green */,
    0x9694ff /* pale purple */,
  ];

  const firstLevelBuildingHeight = 16,
    secondLevelBuildingHeight = 10,
    thirdLevelBuildingHeight = 10,
    fourthLevelBuildingHeight = 9;

  const buildingGeometries = [null, null, null, null, null];

  const buildingMaterial = new THREE.MeshPhongMaterial({ color: 0xffcb78 });
  const domeMaterial = new THREE.MeshPhongMaterial({ color: 0x630808 });
  buildingMaterial.color.convertSRGBToLinear();
  domeMaterial.color.convertSRGBToLinear();

  // Workers
  let workerGeometry;

  const workerMapping = {};
  const firstPlayerColor = 0x0b8fbf;
  const secondPlayerColor = 0xc45618;

  // Win state
  let winningTextMesh = false;

  // Event listeners for mobile support + picking objects
  canvas.addEventListener(
    "touchstart",
    (event) => {
      // prevent the window from scrolling
      event.preventDefault();
      setPickPosition(event.touches[0]);
      const eventActual = event.changedTouches[0];

      startX = eventActual.pageX;
      startY = eventActual.pageY;
    },
    { passive: false }
  );

  canvas.addEventListener("touchmove", (event) => {
    setPickPosition(event.touches[0]);
  });

  canvas.addEventListener("touchend", function (event) {
    const eventActual = event.changedTouches[0];
    const diffX = Math.abs(eventActual.pageX - startX);
    const diffY = Math.abs(eventActual.pageY - startY);

    if (diffX < delta && diffY < delta) {
      findPickedObject(event);
    }
  });
  canvas.addEventListener("mousemove", setPickPosition);
  canvas.addEventListener("mouseout", clearPickPosition);
  canvas.addEventListener("mouseleave", clearPickPosition);

  controls.addEventListener("change", requestRenderIfNotRequested);
  window.addEventListener("resize", requestRenderIfNotRequested);

  const delta = 15;
  let startX;
  let startY;

  canvas.addEventListener("mousedown", function (event) {
    startX = event.pageX;
    startY = event.pageY;
  });

  canvas.addEventListener("mouseup", function (event) {
    const diffX = Math.abs(event.pageX - startX);
    const diffY = Math.abs(event.pageY - startY);

    if (diffX < delta && diffY < delta) {
      findPickedObject(event);
    }
  });

  // Setup engine
  loadSkybox();
  loadBuildingAndWorkerModels();
  makeBoard();
  setupLights();
  render();

  function render() {
    renderRequested = false;

    picked = pickHelper.pick(pickPosition, pickingScene, camera);

    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    controls.update();
    if (tweenRunning) {
      TWEEN.update();
      camera.lookAt(scene.position);
    }

    if (winningTextMesh) {
      winningTextMesh.lookAt(camera.position);
    }

    orbitingLight.position.set(
      camera.position.x + 50,
      camera.position.y + 50,
      camera.position.z + 15
    );

    renderer.render(scene, camera);
  }

  function requestRenderIfNotRequested() {
    if (!renderRequested) {
      renderRequested = true;
      requestAnimationFrame(render);
    }
  }

  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }

  function getCanvasRelativePosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function tweenCamera(camera, duration) {
    tweenRunning = true;

    new TWEEN.Tween(camera.position)
      .to(
        {
          x: 90,
          y: 100,
          z: 90,
        },
        duration
      )
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onComplete(function (obj) {
        tweenRunning = false;
      })
      .start();
  }

  function loadSkybox() {
    const skyboxMaterials = [];
    const textureLoader = new THREE.TextureLoader();

    const skyboxSides = ["ft", "bk", "up", "dn", "rt", "lf"];
    for (const direction of skyboxSides) {
      skyboxMaterials.push(
        new THREE.MeshBasicMaterial({
          map: textureLoader.load(`assets/skybox/downworld_${direction}.png`),
          side: THREE.BackSide,
        })
      );
    }

    const skyboxGeometry = new THREE.BoxBufferGeometry(10000, 10000, 10000);
    const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterials);
    scene.add(skybox);
  }

  function setupLights() {
    skyColor.convertSRGBToLinear();
    groundColor.convertSRGBToLinear();

    const hemiIntensity = 2;
    const hemiLight = new THREE.HemisphereLight(
      skyColor,
      groundColor,
      hemiIntensity
    );
    scene.add(hemiLight);

    orbitingLight = new THREE.SpotLight(0x948779, 0.75);
    orbitingLight.target.position.set(0, 0, 0);
    orbitingLight.castShadow = true;
    orbitingLight.shadow.bias = -0.0001;
    scene.add(orbitingLight);
  }

  function loadBuildingAndWorkerModels() {
    const loader = new THREE.STLLoader();
    const models = ["1st_Floor", "2nd_Floor", "3rd_Floor", "Top_Dome"];

    for (let index = 0; index < models.length; index++) {
      loader.load(
        `./assets/models/Samtorini_${models[index]}.stl`,
        function (geometry) {
          geometry.center();
          buildingGeometries[index + 1] = geometry;
        }
      );
    }

    loader.load(
      "./assets/models/Samtorini_Player_Token.stl",
      function (geometry) {
        geometry.center();
        workerGeometry = geometry;
      }
    );
  }

  function makeBoard() {
    let idForObject = 1;
    let currentColorIndex = Math.floor(
      Math.random() * randomBuildingColors.length
    );

    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        // Create board square
        const boardSquareX = boardOriginX + 8 + x * (16 + gapBetweenSquares);
        const boardSquareZ = boardOriginZ + 8 + z * (16 + gapBetweenSquares);
        const boardSquare = makeMeshFromGeometry(
          boardSquareGeometry,
          0x359906,
          boardSquareX,
          0,
          boardSquareZ
        );

        boardSquare.userData = {
          x: x,
          y: z,
        };

        // Setup tracking/picking for clickability
        const id = idForObject++;

        idToObject[id] = boardSquare;
        boardToId[x][z] = id;
        idToIntersectedBuildings[id] = [];

        const pickingBoardSquare = new THREE.Mesh(
          boardSquareGeometry,
          makePickingMaterial(id)
        );
        pickingScene.add(pickingBoardSquare);
        pickingBoardSquare.position.copy(boardSquare.position);
        pickingBoardSquare.rotation.copy(boardSquare.rotation);
        pickingBoardSquare.scale.copy(boardSquare.scale);

        // Determine color for building on that square
        currentColorIndex = Math.floor(
          Math.random() * randomBuildingColors.length
        );
        colorForId[id] = currentColorIndex;
      }
    }
  }

  function getRandomizedColors() {
    return colorForId;
  }

  function setRandomizedColors(colors) {
    for (const id in colorForId) {
      colorForId[id] = colors.shift();
    }
  }

  function makeMeshFromGeometry(geometry, color, x = 0, y = 0, z = 0) {
    const material = new THREE.MeshStandardMaterial({ color });
    material.toneMapped = true;
    material.color.convertSRGBToLinear();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    mesh.position.x = x;
    mesh.position.y = y;
    mesh.position.z = z;

    return mesh;
  }

  function clearBoardHighlights() {
    for (const idColorPair of highlightedBoardSquares) {
      const id = idColorPair.id;
      const color = idColorPair.originalColor;

      const buildings = idToIntersectedBuildings[id];

      for (const building of buildings) {
        building.material.color.setHex(randomBuildingColors[colorForId[id]]);
        building.material.color.convertSRGBToLinear();
      }
      idToObject[id].material.color.setHex(color);
    }
    highlightedBoardSquares = [];
  }

  function setBoardHighlight(row, column) {
    const id = boardToId[row][column];
    const boardPiece = idToObject[id];
    const selectionColor = 0xffdd00;
    const originalColor = boardPiece.material.color.getHex();
    boardPiece.material.color.setHex(0xffdd00);

    for (const building of idToIntersectedBuildings[id]) {
      building.material.color.setHex(selectionColor);
    }
    highlightedBoardSquares.push({ id, originalColor });
  }

  function getXZForBoardPosition(row, column) {
    const width = getSize(boardSquareGeometry).x;

    return {
      x: boardOriginX + 8 + row * (width + gapBetweenSquares),
      z: boardOriginZ + 8 + column * (width + gapBetweenSquares),
    };
  }

  function getSize(geometry) {
    let size = new THREE.Vector3();
    geometry.computeBoundingBox();
    geometry.boundingBox.getSize(size);
    return size;
  }

  function makePickingMaterial(id) {
    return new THREE.MeshPhongMaterial({
      emissive: new THREE.Color(id),
      color: new THREE.Color(0, 0, 0),
      specular: new THREE.Color(0, 0, 0),
      transparent: true,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
  }

  function setPickPosition(event) {
    const pos = getCanvasRelativePosition(event);
    pickPosition.x = pos.x;
    pickPosition.y = pos.y;

    requestRenderIfNotRequested();
  }

  function clearPickPosition() {
    // unlike the mouse which always has a position
    // if the user stops touching the screen we want
    // to stop picking. For now we just pick a value
    // unlikely to pick something
    pickPosition.x = -100000;
    pickPosition.y = -100000;
  }

  function findPickedObject() {
    if (picked) {
      clickHandler({ row: picked.userData.x, column: picked.userData.y });
    }

    requestRenderIfNotRequested();
  }

  function addBuilding(currentLevelAtPosition, row, column) {
    const spot = getXZForBoardPosition(row, column);
    const geom = buildingGeometries[currentLevelAtPosition].clone();
    const baseH = getBaseHeightForBuilding(currentLevelAtPosition);

    const geometrySize = getSize(geom);
    const buildingSize = [0, 16, 16, 16, 16][currentLevelAtPosition];
    const buildingHeight = [
      0,
      firstLevelBuildingHeight,
      secondLevelBuildingHeight,
      thirdLevelBuildingHeight,
      fourthLevelBuildingHeight,
    ][currentLevelAtPosition];
    const scaleFactorX = buildingSize / geometrySize.x;
    const scaleFactorY = buildingSize / geometrySize.y;
    const scaleFactorZ = buildingHeight / geometrySize.z;

    const mat =
      currentLevelAtPosition == 4
        ? domeMaterial.clone()
        : buildingMaterial.clone();

    const id = boardToId[row][column];

    if (currentLevelAtPosition != 4) {
      mat.color.setHex(randomBuildingColors[colorForId[id]]);
      mat.color.convertSRGBToLinear();
    }

    const mesh = track(new THREE.Mesh(geom, mat));
    mesh.userData = {
      x: column,
      y: row,
    };

    mesh.position.set(spot.x, baseH, spot.z);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.scale.set(scaleFactorX, scaleFactorY, scaleFactorZ);

    mesh.castShadow = false;
    mesh.receiveShadow = true;

    idToIntersectedBuildings[id].push(mesh);

    const pickingMaterial = makePickingMaterial(id);

    const pickingCube = track(new THREE.Mesh(geom, pickingMaterial));
    pickingScene.add(pickingCube);
    pickingCube.position.copy(mesh.position);
    pickingCube.rotation.copy(mesh.rotation);
    pickingCube.scale.copy(mesh.scale);

    scene.add(mesh);
  }

  function getWorkerHeightForBuilding(level) {
    const height = getSize(boardSquareGeometry).y;

    switch (level) {
      case 0:
        return height * 0.5 + 10 * 0.5;
      case 1:
        return firstLevelBuildingHeight + getWorkerHeightForBuilding(0);
      case 2:
        return secondLevelBuildingHeight + getWorkerHeightForBuilding(1);
      case 3:
        return thirdLevelBuildingHeight + getWorkerHeightForBuilding(2);
    }
  }

  function getBaseHeightForBuilding(level) {
    const height = getSize(boardSquareGeometry).y;

    switch (level) {
      case 0:
        return height * 0.5;
      case 1:
        return firstLevelBuildingHeight / 2 + height * 0.5;
      case 2:
        return (
          secondLevelBuildingHeight / 2 +
          firstLevelBuildingHeight / 2 +
          getBaseHeightForBuilding(1) -
          0
        );
      case 3:
        return (
          thirdLevelBuildingHeight / 2 +
          secondLevelBuildingHeight / 2 +
          getBaseHeightForBuilding(2) -
          0
        );
      case 4:
        return (
          fourthLevelBuildingHeight / 2 +
          thirdLevelBuildingHeight / 2 +
          getBaseHeightForBuilding(3)
        );
    }
    return -10;
  }

  function addWorker(worker, row, column) {
    const position = getXZForBoardPosition(
      worker.position[0],
      worker.position[1]
    );
    const color = worker.id < 2 ? firstPlayerColor : secondPlayerColor;
    const material = new THREE.MeshToonMaterial({ color });
    material.color.convertSRGBToLinear();
    const workerMesh = track(new THREE.Mesh(workerGeometry, material));
    workerMesh.castShadow = false;
    workerMesh.receiveShadow = true;

    scene.add(workerMesh);

    workerMesh.position.set(
      position.x,
      getWorkerHeightForBuilding(0),
      position.z
    );
    workerMesh.rotation.set(-Math.PI / 2, 0, 0);

    const id = boardToId[row][column];
    workerMesh.userData = {
      x: row,
      y: column,
      id: id,
    };

    const geometrySize = getSize(workerGeometry);

    const scaleFactorX = 8 / geometrySize.x;
    const scaleFactorY = 10 / geometrySize.y;
    const scaleFactorZ = 14 / geometrySize.z;

    workerMesh.scale.set(scaleFactorX, scaleFactorY, scaleFactorZ);

    workerMapping[worker.id] = workerMesh;

    const pickingMaterial = makePickingMaterial(id);

    const pickingCube = track(new THREE.Mesh(workerGeometry, pickingMaterial));
    pickingScene.add(pickingCube);
    pickingCube.position.copy(workerMesh.position);
    pickingCube.rotation.copy(workerMesh.rotation);
    pickingCube.scale.copy(workerMesh.scale);
    idToPickingCube[id] = pickingCube;
  }

  function moveWorkerToPosition(workerID, row, column, boardLevel) {
    const workerObject = workerMapping[workerID];
    const translatedPosition = getXZForBoardPosition(row, column);

    workerObject.position.x = translatedPosition.x;
    workerObject.position.y = getWorkerHeightForBuilding(boardLevel);
    workerObject.position.z = translatedPosition.z;

    const id = workerObject.userData.id;
    const newId = boardToId[row][column];
    pickingScene.remove(idToPickingCube[id]);
    delete idToPickingCube[id];

    const pickingMaterial = makePickingMaterial(newId);

    const newPickingCube = new THREE.Mesh(workerGeometry, pickingMaterial);
    pickingScene.add(newPickingCube);
    newPickingCube.position.copy(workerObject.position);
    newPickingCube.rotation.copy(workerObject.rotation);
    newPickingCube.scale.copy(workerObject.scale);

    idToPickingCube[newId] = newPickingCube;

    workerObject.userData.id = newId;
  }

  function winStateRotate(youWin) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1 * -0.75;

    const loader = new THREE.FontLoader();
    loader.load("assets/fonts/helvetiker_bold.typeface.json", function (font) {
      const textGeo = new THREE.TextBufferGeometry(
        youWin ? "YOU WIN!" : "THEY WIN.",
        {
          font: font,

          size: 8,
          height: 2,
          curveSegments: 25,
        }
      );

      textGeo.center();

      const textMaterial = new THREE.MeshPhongMaterial({ color: 0xf1b832 });
      textMaterial.color.convertSRGBToLinear();

      winningTextMesh = track(new THREE.Mesh(textGeo, textMaterial));
      winningTextMesh.position.y = 60;

      winningTextMesh.castShadow = false;
      winningTextMesh.receiveShadow = false;

      scene.add(winningTextMesh);

      tweenCamera(camera, 1500);
    });
  }

  function clearBuildingsAndWorkers() {
    resourceTracker.dispose();
    controls.autoRotate = false;
  }

  return {
    addBuilding,
    addWorker,
    moveWorkerToPosition,
    setBoardHighlight,
    clearBoardHighlights,
    clearBuildingsAndWorkers,
    winStateRotate,
    getRandomizedColors,
    setRandomizedColors,
  };
}
