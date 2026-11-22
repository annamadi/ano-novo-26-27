// Preencha com os dados do projeto no Supabase (Project Settings > API).
// A chave "anon/publishable" é pública por natureza: quem protege os dados é o login.
// Com os campos vazios, o site roda em modo local (dados só neste navegador).
window.APP_CONFIG = {
  supabaseUrl: "https://zuwtptbvtyxdacyzsijf.supabase.co",
  supabaseKey: "sb_publishable_ljv8qbWQEd081KA70kKKgA_l_0OfhVh",
  // Cada pessoa entra com o primeiro nome; o site monta "nome@loginDomain".
  // No Supabase, crie os usuários assim: nome@anonovo.invalid, etc.
  loginDomain: "anonovo.invalid",
};
