"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processChartImage = processChartImage;
exports.generateThumbnail = generateThumbnail;
const sharp_1 = __importDefault(require("sharp"));
const path_1 = __importDefault(require("path"));
async function processChartImage(filePath) {
    const ext = path_1.default.extname(filePath);
    const processedPath = filePath.replace(ext, `_processed${ext}`);
    await (0, sharp_1.default)(filePath)
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .sharpen()
        .normalize()
        .toFile(processedPath);
    return processedPath;
}
async function generateThumbnail(filePath) {
    const ext = path_1.default.extname(filePath);
    const thumbPath = filePath.replace(ext, `_thumb${ext}`);
    await (0, sharp_1.default)(filePath)
        .resize(400, 225, { fit: 'cover' })
        .toFile(thumbPath);
    return thumbPath;
}
//# sourceMappingURL=imageService.js.map