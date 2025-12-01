import os
import io
import torch
import torch.nn as nn
from torchvision import transforms
from PIL import Image

# ==========================================
# 1. MODEL ARCHITECTURE (Must match training)
# ==========================================
class Small3DCNN(nn.Module):
    def __init__(self, in_channels: int = 3):
        super().__init__()
        self.conv_block1 = nn.Sequential(
            nn.Conv3d(in_channels, 16, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
            nn.BatchNorm3d(16),
            nn.ReLU(inplace=True),
            nn.MaxPool3d(kernel_size=(1, 2, 2)),
        )
        self.conv_block2 = nn.Sequential(
            nn.Conv3d(16, 32, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
            nn.BatchNorm3d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool3d(kernel_size=(1, 2, 2)),
        )
        self.conv_block3 = nn.Sequential(
            nn.Conv3d(32, 64, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
            nn.BatchNorm3d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool3d(kernel_size=(1, 2, 2)),
        )
        self.global_pool = nn.AdaptiveAvgPool3d((1, 1, 1))
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(64, 32),
            nn.ReLU(inplace=True),
            nn.Dropout(p=0.5),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        # x: [B, C, H, W] → [B, C, 1, H, W]
        x = x.unsqueeze(2)
        x = self.conv_block1(x)
        x = self.conv_block2(x)
        x = self.conv_block3(x)
        x = self.global_pool(x)
        return self.classifier(x).view(-1)


# ==========================================
# 2. INFERENCE CLASS (Pipeline API)
# ==========================================
class SpikeClassifier:
    def __init__(self, model_path: str, device: str | None = None):
        """
        Initialize the model once.

        Parameters
        ----------
        model_path : str
            Path to your .pth file
        device : str or None
            'cuda', 'cpu', or None (auto-select)
        """
        self.device = device if device else ("cuda" if torch.cuda.is_available() else "cpu")
        print(f"Loading orientation model on {self.device}...")

        # Load Architecture
        self.model = Small3DCNN(in_channels=3).to(self.device)
        
        # Load Weights
        state_dict = torch.load(model_path, map_location=self.device)
        self.model.load_state_dict(state_dict)
        self.model.eval()  # Set to evaluation mode

        # Define Preprocessing
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ])

    def predict(self, image_bytes: bytes) -> dict:
        """
        Args
        ----
        image_bytes : bytes
            Raw bytes from the file (e.g., f.read())

        Returns
        -------
        dict
            {'label': str, 'confidence': float, 'raw_score': float}
            or {'error': str}
        """
        try:
            # 1. Open Image
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            
            # 2. Preprocess
            input_tensor = self.transform(image).unsqueeze(0).to(self.device)
            
            # 3. Inference
            with torch.no_grad():
                logits = self.model(input_tensor)
                prob = torch.sigmoid(logits).item()
            
            # 4. Result Logic (Threshold 0.5)
            threshold = 0.75 
            
            if prob > threshold:
                label = "Good Orientation"
                confidence = prob
            else:
                label = "Bad Orientation"
                confidence = 1.0 - prob  # Invert confidence for the negative class

            return {
                "label": label,
                "confidence": round(confidence * 100, 2),
                "raw_score": prob,
            }

        except Exception as e:
            return {"error": str(e)}


# ==========================================
# 3. EXAMPLE USAGE (CLI)
# ==========================================
if __name__ == "__main__":
    # Path to your trained weights
    MODEL_PATH = "small_3dcnn_best.pth"
    
    # 1. Initialize classifier (Do this ONCE)
    classifier = SpikeClassifier(MODEL_PATH)

    # 2. Test image
    test_image_path = "test_image.jpg"
    
    if os.path.exists(test_image_path):
        with open(test_image_path, "rb") as f:
            file_bytes = f.read()
        
        # 3. Get Prediction
        result = classifier.predict(file_bytes)
        print(f"Prediction: {result}")
    else:
        print("Test image not found. Please provide a path to check.")
