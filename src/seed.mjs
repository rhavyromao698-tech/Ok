import { createDatabase, seedDemoData, DEFAULT_DB_PATH } from './db.mjs';

const db = createDatabase(process.env.RDA_DB_PATH || DEFAULT_DB_PATH);
const result = seedDemoData(db);
console.log(`Banco preparado em ${process.env.RDA_DB_PATH || DEFAULT_DB_PATH}`);
console.log(`Dados demonstrativos: processo Social ${result.processId}, parceiro ${result.partnerId}`);
db.close();
