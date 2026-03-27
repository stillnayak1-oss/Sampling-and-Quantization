document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const uploadBtn = document.getElementById('uploadBtn');
    const imageInput = document.getElementById('imageInput');
    const fileNameDisplay = document.getElementById('fileName');
    
    const samplingSlider = document.getElementById('samplingRate');
    const samplingValue = document.getElementById('samplingValue');
    const quantSlider = document.getElementById('quantizationLevels');
    const quantValue = document.getElementById('quantizationValue');
    
    const modeRadios = document.querySelectorAll('input[name="colorMode"]');
    const resetBtn = document.getElementById('resetBtn');
    
    const originalCanvas = document.getElementById('originalCanvas');
    const processedCanvas = document.getElementById('processedCanvas');
    const ctxOriginal = originalCanvas.getContext('2d', { willReadFrequently: true });
    const ctxProcessed = processedCanvas.getContext('2d', { willReadFrequently: true });
    
    const loadingOverlay = document.getElementById('loadingOverlay');
    const origStatRes = document.getElementById('origStatRes');
    const origStatColors = document.getElementById('origStatColors');
    const statRes = document.getElementById('statRes');
    const statColors = document.getElementById('statColors');

    // --- State ---
    let currentImage = new Image();
    let isProcessing = false;
    let pendingUpdate = false;

    // --- Initialization ---
    // Try to load default sample
    currentImage.onload = () => {
        initCanvases();
        triggerProcess();
    };
    currentImage.onerror = () => {
        console.warn("Could not load default sample. Wait for user upload.");
    };
    // Default image source from earlier step
    currentImage.src = 'sample.png';

    // --- Event Listeners ---
    uploadBtn.addEventListener('click', () => imageInput.click());
    
    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            fileNameDisplay.textContent = file.name;
            const reader = new FileReader();
            reader.onload = (event) => {
                currentImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    samplingSlider.addEventListener('input', (e) => {
        samplingValue.textContent = e.target.value + 'x';
        requestProcess();
    });

    quantSlider.addEventListener('input', (e) => {
        quantValue.textContent = e.target.value;
        requestProcess();
    });

    modeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            requestProcess();
        });
    });

    resetBtn.addEventListener('click', () => {
        samplingSlider.value = 1;
        samplingValue.textContent = '1x';
        quantSlider.value = 256;
        quantValue.textContent = '256';
        document.getElementById('modeRGB').checked = true;
        requestProcess();
    });

    // --- Core Functions ---
    function initCanvases() {
        const MAX_DIM = 800; // Cap logical size for performance
        let scale = 1;

        if (currentImage.width > MAX_DIM || currentImage.height > MAX_DIM) {
            scale = Math.min(MAX_DIM / currentImage.width, MAX_DIM / currentImage.height);
        }

        const logicW = Math.floor(currentImage.width * scale);
        const logicH = Math.floor(currentImage.height * scale);

        originalCanvas.width = logicW;
        originalCanvas.height = logicH;
        processedCanvas.width = logicW;
        processedCanvas.height = logicH;

        ctxOriginal.drawImage(currentImage, 0, 0, logicW, logicH);
        
        calculateOriginalStats(logicW, logicH);
    }

    function calculateOriginalStats(w, h) {
        origStatRes.textContent = `Res: ${w} × ${h}`;
        origStatColors.textContent = `Colors: Computing...`;
        
        requestAnimationFrame(() => {
            const imgData = ctxOriginal.getImageData(0, 0, w, h);
            const data = imgData.data;
            const colorSet = new Set();
            for (let i = 0; i < data.length; i += 4) {
                colorSet.add(`${data[i]},${data[i+1]},${data[i+2]}`);
            }
            
            if (colorSet.size >= 1000) {
                origStatColors.textContent = `Colors: ${(colorSet.size / 1000).toFixed(1)}k`;
            } else {
                origStatColors.textContent = `Colors: ${colorSet.size}`;
            }
        });
    }

    // Debounce processing to keep UI smooth with large inputs
    function requestProcess() {
        if (isProcessing) {
            pendingUpdate = true;
            return;
        }
        triggerProcess();
    }

    function triggerProcess() {
        isProcessing = true;
        loadingOverlay.classList.add('active');
        
        // Use requestAnimationFrame so overlay shows up before blocking thread
        requestAnimationFrame(() => {
            processImage();
            loadingOverlay.classList.remove('active');
            isProcessing = false;
            
            if (pendingUpdate) {
                pendingUpdate = false;
                requestProcess();
            }
        });
    }

    function processImage() {
        if (originalCanvas.width === 0) return;

        const w = originalCanvas.width;
        const h = originalCanvas.height;
        const imgData = ctxOriginal.getImageData(0, 0, w, h);
        const data = imgData.data;

        const sampleFactor = parseInt(samplingSlider.value, 10);
        const quantLevels = parseInt(quantSlider.value, 10);
        const isGrayscale = document.getElementById('modeGray').checked;

        const newData = ctxProcessed.createImageData(w, h);
        const nData = newData.data;

        // Step size for level quantization
        // If levels = 256, factor = 255/255 = 1
        // If levels = 2, factor = 255/1 = 255
        // It maps values 0-255 into 'quantLevels' bins.
        const quantStep = 255 / (quantLevels - 1);

        // Tracking unique colors
        const colorSet = new Set();

        for (let y = 0; y < h; y += sampleFactor) {
            for (let x = 0; x < w; x += sampleFactor) {
                // Get the top-left pixel of the sample block
                const index = (y * w + x) * 4;
                let r = data[index];
                let g = data[index + 1];
                let b = data[index + 2];
                let a = data[index + 3];

                if (isGrayscale) {
                    // Luminance formula
                    const gray = r * 0.299 + g * 0.587 + b * 0.114;
                    r = gray; g = gray; b = gray;
                }

                // Quantization
                r = Math.round(Math.round(r / quantStep) * quantStep);
                g = Math.round(Math.round(g / quantStep) * quantStep);
                b = Math.round(Math.round(b / quantStep) * quantStep);

                const colorHash = `${r},${g},${b}`;
                colorSet.add(colorHash);

                // Fill block for sampling
                for (let dy = 0; dy < sampleFactor; dy++) {
                    for (let dx = 0; dx < sampleFactor; dx++) {
                        if (x + dx < w && y + dy < h) {
                            const blockIndex = ((y + dy) * w + (x + dx)) * 4;
                            nData[blockIndex] = r;
                            nData[blockIndex + 1] = g;
                            nData[blockIndex + 2] = b;
                            nData[blockIndex + 3] = a;
                        }
                    }
                }
            }
        }

        ctxProcessed.putImageData(newData, 0, 0);

        // Update stats
        const newW = Math.ceil(w / sampleFactor);
        const newH = Math.ceil(h / sampleFactor);
        
        statRes.textContent = `Res: ${newW} × ${newH}`;
        
        if (colorSet.size >= 1000) {
            statColors.textContent = `Colors: ${(colorSet.size / 1000).toFixed(1)}k`;
        } else {
            statColors.textContent = `Colors: ${colorSet.size}`;
        }
    }
});
