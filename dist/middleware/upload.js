"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const config_1 = require("../config");
const fs_1 = __importDefault(require("fs"));
const uploadDir = path_1.default.join(process.cwd(), config_1.config.upload.dir);
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        cb(null, `${(0, uuid_1.v4)()}${ext}`);
    },
});
const fileFilter = (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
    const ext = path_1.default.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    }
    else {
        cb(new Error('Only PNG, JPG, JPEG, and WebP files are allowed'));
    }
};
exports.upload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: { fileSize: config_1.config.upload.maxFileSize },
});
//# sourceMappingURL=upload.js.map