// ============================================================
// SUPABASE CONFIG — real project, created and configured directly
// Project: clarus-recording (ap-south-1 / Mumbai)
// Storage bucket "recordings" already created, with an upload-only
// policy for this public key (no public read/download access).
// ============================================================

const SUPABASE_URL = "https://jqsoxogpzjlmmdrkxzdw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5U5TC1nJiyAbYxoTYcIVVg_7WPhwFSM";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
