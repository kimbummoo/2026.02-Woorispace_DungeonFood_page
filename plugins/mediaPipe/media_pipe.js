import { FaceLandmarker, FilesetResolver, DrawingUtils } from "./libs/vision_bundle_esm.js";

// --- 전역 설정 (초기에는 선언만) ---
let inputCanvas;

let faceLandmarker;
let lastTimestamp = -1;
let isInitialized = false;

// --- Unity 연동 인터페이스 ---
window.faceData = "";
window.getFaceData = () => window.faceData;

/**
 * [유니티 또는 앱에서 호출] 
 * 카메라 화면이 준비되었을 때 이 함수를 호출하여 MediaPipe를 시작합니다.
 */
window.initMediaPipe = async (successFunc) => {

    // 매번 호출 시 요소를 다시 찾음 (SPA 환경 대응)
    inputCanvas = document.getElementById("webcam-video");

    if (!inputCanvas) {
        console.warn("MediaPipe 초기화 실패: 필수 DOM 요소를 찾을 수 없습니다.");
        return;
    }

    if (isInitialized) {
        console.log("MediaPipe가 이미 초기화되어 있습니다.");
        return;
    }

    try {

        console.log("MediaPipe 모델 로딩 중...");

        // 실행 시점의 호스트 경로에 맞게 절대 경로(루트기준) 혹은 바른 상대 경로 설정
        const fileset = await FilesetResolver.forVisionTasks("./plugins/mediaPipe/libs/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `./plugins/mediaPipe/models/face_landmarker.task`, delegate: "GPU" },
            outputFaceBlendshapes: true,
            runningMode: "VIDEO",
            numFaces: 1
        });

        isInitialized = true;

        console.log("MediaPipe 준비 완료. 카메라 재생 대기 중...");

        // 카메라가 실제로 데이터를 보내기 시작할 때(playing) 트래킹 시작
        if (inputCanvas.readyState >= 3) { // 이미 재생 중인 경우
            predict();
            if (typeof successFunc === "function") successFunc();
        }
        else {
            inputCanvas.addEventListener('playing', () => {
                console.log("카메라 재생 시작 - 트래킹을 개시합니다.");
                predict();
                if (typeof successFunc === "function") successFunc();
            }, { once: true });
        }
    }
    catch (error) {
        console.error("MediaPipe 초기화 실패:", error);
    }
};

// --- 메인 루프 ---
async function predict() {

    // 요소 확인 및 해상도 유효성 체크
    if (!inputCanvas || !faceLandmarker) {

        // 매프레임 시 마다 호출될 콜백 함수 지정
        if (isInitialized) window.requestAnimationFrame(predict);

        return;
    }

    // 비디오 기반인 경우 videoWidth 사용
    const width = inputCanvas.videoWidth || inputCanvas.width;
    const height = inputCanvas.videoHeight || inputCanvas.height;

    const startTimeMs = performance.now();

    // 데이터 추출
    if (startTimeMs !== lastTimestamp && width > 0) {
        lastTimestamp = startTimeMs;
        const results = faceLandmarker.detectForVideo(inputCanvas, startTimeMs);
        handleResults(results, width, height);
    }

    window.requestAnimationFrame(predict);
}

function handleResults(results, width, height) {
    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];

        // 1. 시각화 (제거됨 - Unity에서 수행)

        // 2. 필요 시 데이터 가공

        // 주요 랜드마크 추출 (인덱스 참고: 기본 코눈턱 등)
        let noseTip = landmarks[1];
        let leftEye = landmarks[33];
        let rightEye = landmarks[263];
        let topOfHead = landmarks[10];
        let bottomOfChin = landmarks[152];

        // --- 거리(Distance) 계산 ---
        let dx = rightEye.x - leftEye.x;
        let dy = rightEye.y - leftEye.y;
        let eyeDist = Math.sqrt(dx * dx + dy * dy);
        // 상수 0.07은 대략적인 기준값 (실험을 통해 조정 가능)
        let distance = 0.07 / (eyeDist + 0.00001) * 100;

        console.log("distance : ", distance);

        // 얼굴 회전 축 벡터 계산
        // X축 (Right): 왼쪽 눈에서 오른쪽 눈을 향하는 벡터
        let dxRight = rightEye.x - leftEye.x;
        let dyRight = rightEye.y - leftEye.y;
        let dzRight = rightEye.z - leftEye.z;
        let rightMag = Math.sqrt(dxRight * dxRight + dyRight * dyRight + dzRight * dzRight);
        dxRight /= rightMag; dyRight /= rightMag; dzRight /= rightMag;

        // Y축 (Up): 턱에서 이마를 향하는 벡터
        let dxUp = topOfHead.x - bottomOfChin.x;
        let dyUp = topOfHead.y - bottomOfChin.y;
        let dzUp = topOfHead.z - bottomOfChin.z;
        let upMag = Math.sqrt(dxUp * dxUp + dyUp * dyUp + dzUp * dzUp);
        dxUp /= upMag; dyUp /= upMag; dzUp /= upMag;

        // Yaw, Pitch, Roll 근사값 계산 (라디안 -> 디그리)
        // MediaPipe에서 x는 오른쪽, y는 아래, z는 멀어지는 방향
        let pitch = Math.asin(dyUp) * (180 / Math.PI); // 고개 위/아래
        let yaw = Math.atan2(-dzRight, dxRight) * (180 / Math.PI); // 고개 좌/우 회전
        let roll = Math.atan2(dyRight, dxRight) * (180 / Math.PI); // 목꺾임 (갸우뚱)

        // Unity에서 파싱하기 쉽게 간단한 JSON 생성
        let simplifiedData = {
            pitch: pitch,
            yaw: yaw,
            roll: roll,
            distance: distance,
            noseX: noseTip.x,
            noseY: noseTip.y,
            noseZ: noseTip.z,
            vidW: width,
            vidH: height
        };

        // 상태 변화 시에만 콘솔 기록 (로그 폭주 방지)
        if (window.faceData === "") console.log("Tracking Active");

        window.faceData = JSON.stringify(simplifiedData);
    } else {
        if (window.faceData !== "") {
            console.log("얼굴을 찾을 수 없음 (Searching for face...)");
            window.faceData = "";
        }
    }
}
