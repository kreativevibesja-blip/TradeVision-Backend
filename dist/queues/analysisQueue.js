"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analysisQueue = exports.analysisQueueConnection = void 0;
exports.enqueueAnalysisJob = enqueueAnalysisJob;
const bullmq_1 = require("bullmq");
const config_1 = require("../config");
const redisUrl = new URL(config_1.config.redis.url);
exports.analysisQueueConnection = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    db: redisUrl.pathname ? Number(redisUrl.pathname.replace('/', '') || '0') : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(config_1.config.redis.tls ? { tls: {} } : {}),
};
exports.analysisQueue = new bullmq_1.Queue(config_1.config.analysis.queueName, {
    connection: exports.analysisQueueConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
    },
});
async function enqueueAnalysisJob(data) {
    return exports.analysisQueue.add('analyze-chart', data, {
        jobId: data.analysisId,
    });
}
//# sourceMappingURL=analysisQueue.js.map