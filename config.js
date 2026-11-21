// Preencha com os dados do projeto no Supabase (Project Settings > API).
// A chave "anon/publishable" é pública por natureza: quem protege os dados é o login.
// Com os campos vazios, o site roda em modo local (dados só neste navegador).
window.APP_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
  // Cada pessoa entra com o primeiro nome; o site monta "nome@loginDomain".
  // No Supabase, crie os usuários assim: anna@anonovo.invalid, etc.
  loginDomain: "anonovo.invalid",
};
