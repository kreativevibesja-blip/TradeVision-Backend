"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const index_1 = require("./index");
const supabaseServerKey = index_1.config.supabase.serviceRoleKey || index_1.config.supabase.anonKey;
if (!index_1.config.supabase.url || !supabaseServerKey) {
    throw new Error('Missing Supabase backend configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY.');
}
exports.supabase = (0, supabase_js_1.createClient)(index_1.config.supabase.url, supabaseServerKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});
//# sourceMappingURL=supabase.js.map