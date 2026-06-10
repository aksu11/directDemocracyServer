/**
 * Käyttö:
 *   node scripts/addAdmin.js <käyttäjänimi>
 *
 * Esimerkki:
 *   node scripts/addAdmin.js matti
 */

require('dotenv').config();
const readline = require('readline');
const { upsertAdmin } = require('../src/services/admins');

async function main() {
  const username = process.argv[2];

  if (!username) {
    console.error('Käyttö: node scripts/addAdmin.js <käyttäjänimi>');
    process.exit(1);
  }

  // Luetaan salasana stdin:stä jotta se ei jää shell-historiaan
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`Salasana käyttäjälle "${username}": `, async (password) => {
    rl.close();

    if (!password || password.length < 8) {
      console.error('Salasana on liian lyhyt (vähintään 8 merkkiä).');
      process.exit(1);
    }

    await upsertAdmin(username, password, 'admin');
    console.log(`Admin "${username}" tallennettu onnistuneesti.`);
  });
}

main();
