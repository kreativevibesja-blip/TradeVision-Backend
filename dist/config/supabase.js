"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const index_1 = require("./index");
if (!index_1.config.supabase.url || !index_1.config.supabase.anonKey) {
    throw new Error('Missing Supabase backend configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
}
exports.supabase = (0, supabase_js_1.createClient)(index_1.config.supabase.url, index_1.config.supabase.anonKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});
//# sourceMappingURL=supabase.js.map