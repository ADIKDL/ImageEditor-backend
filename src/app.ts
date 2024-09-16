import express, { Request, Response } from "express";
import multer, { memoryStorage } from "multer";
import sharp from "sharp";
import cors from "cors";
import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Configure Multer for file uploads
const storage = memoryStorage();
const upload = multer({ storage });

// Type definitions for image processing results
interface ProcessedImageData {
  brightness: number;
  contrast: number;
  saturation: number;
}

app.post("/upload", upload.single("image"), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image provided" });
  }

  try {
    const format: keyof sharp.FormatEnum = (req.body.format as keyof sharp.FormatEnum) || "jpeg"; // default to JPEG if not specified
    const previewBuffer = await sharp(req.file.buffer)
      .resize({ width: 300 }) // Lower resolution for quick preview
      .toFormat(format)
      .toBuffer();

    // Extract raw pixel data using Sharp
    const { data, info } = await sharp(req.file.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    let totalBrightness = 0;
    let totalContrast = 0;
    let totalSaturation = 0;

    // Iterate over pixel data (each pixel has 3 values: R, G, B)
    for (let i = 0; i < data.length; i += 3) {
      const red = data[i];
      const green = data[i + 1];
      const blue = data[i + 2];

      // Ensure that RGB values are valid
      if (red >= 0 && green >= 0 && blue >= 0) {
        // Brightness calculation: average of RGB values (0-255)
        const brightness = (red + green + blue) / 3;
        totalBrightness += brightness;

        // Contrast calculation: difference between max and min RGB values
        const maxColor = Math.max(red, green, blue);
        const minColor = Math.min(red, green, blue);
        totalContrast += maxColor - minColor;

        // Saturation calculation (avoid division by zero)
        const maxMinDiff = maxColor - minColor;
        const totalRGB = red + green + blue;
        if (totalRGB > 0) {
          totalSaturation += maxMinDiff / (totalRGB / 3);
        }
      }
    }

    const pixelCount = info.width * info.height;

    // Save the original file temporarily
    const tempFilePath = path.join(__dirname, "..","uploads", req.file.originalname);
    fs.writeFileSync(tempFilePath, req.file.buffer);

    // Ensure pixelCount is valid
    if (pixelCount > 0) {
      // Calculate the average values, scaling them appropriately
      const avgBrightness = (totalBrightness / pixelCount / 255) * 100; // Scale to 0-100
      const avgContrast = (totalContrast / pixelCount / 255) * 100; // Scale to 0-100
      const avgSaturation = (totalSaturation / pixelCount) * 100; // Scale to 0-100

      const imageData: ProcessedImageData = {
        brightness: parseFloat(avgBrightness.toFixed(2)),
        contrast: parseFloat(avgContrast.toFixed(2)),
        saturation: parseFloat(avgSaturation.toFixed(2)),
      };

      res.json({
        message: `Image uploaded successfully`,
        preview: `data:image/${format};base64,${previewBuffer.toString("base64")}`,
        ...imageData,
        tempFilePath: tempFilePath,
      });
    } else {
      throw new Error("Pixel count is zero, invalid image data");
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process image" });
  }
});

app.post("/process", async (req: Request, res: Response) => {
  const { tempFilePath, brightness, contrast, saturation, rotation, format } = req.body;

  try {
    const brightnessValue = parseFloat(brightness) || 1;
    const contrastValue = parseFloat(contrast) || 1;
    const saturationValue = parseFloat(saturation) || 1;
    const rotationValue = parseFloat(rotation) || 0;

    let image = sharp(tempFilePath)
      .modulate({
        brightness: brightnessValue,
        saturation: saturationValue,
      })
      .rotate(rotationValue);

    // Adjust contrast if needed (contrastValue is not 1)
    if (contrastValue !== 1) {
      image = image.linear(contrastValue, -(0.5 * contrastValue) + 0.5);
    }

    const processedImageBuffer = await image.toFormat(format || "jpeg").toBuffer();

    res.json({
      processedImage: `data:image/${format};base64,${processedImageBuffer.toString("base64")}`,
      preview: `data:image/${format};base64,${processedImageBuffer.toString("base64")}`,
      brightness: brightnessValue,
      contrast: contrastValue,
      saturation: saturationValue,
      tempFilePath: tempFilePath,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process image" });
  }
});


// Final image download with applied transformations
app.post("/download", async (req: Request, res: Response) => {
  const { tempFilePath, brightness, contrast, saturation, rotation, format } = req.body;

  try {
    const brightnessValue = parseFloat(brightness) || 1;
    const contrastValue = parseFloat(contrast) || 1;
    const saturationValue = parseFloat(saturation) || 1;
    const rotationValue = parseFloat(rotation) || 0;

    let image = sharp(tempFilePath)
      .modulate({
        brightness: brightnessValue,
        saturation: saturationValue,
      })
      .rotate(rotationValue);

    // Apply contrast if necessary
    if (contrastValue !== 1) {
      image = image.linear(contrastValue, -(0.5 * contrastValue) + 0.5);
    }

    const finalImageBuffer = await image.toFormat(format || "jpeg").toBuffer();

    res.set({
      "Content-Type": `image/${format}`,
      "Content-Disposition": `attachment; filename=processed.${format}`,
    });

    res.send(finalImageBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to download image" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
