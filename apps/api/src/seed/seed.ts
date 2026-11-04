import { seedDemo } from './flows';

seedDemo(process.env.API_URL ?? 'http://localhost:3000', process.env.API_KEY || undefined)
  .then((balances) => console.log('seeded. balances (cents, normal side):', balances))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
