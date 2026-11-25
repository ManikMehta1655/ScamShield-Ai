import { getConnectionString } from '@netlify/database';
import pg from 'pg';
import { createHandler } from '../../server/api.mjs';
let pool, handler;
export default async (request, context) => {
  try {
    if (!handler) {
      pool = new pg.Pool({connectionString:getConnectionString(),max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});
      pool.on('error',()=>{});
      handler=createHandler(pool);
    }
    return await handler(request,context);
  } catch {
    return Response.json({detail:'Database temporarily unavailable. Check Netlify Database provisioning.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
};
export const config = {path:['/api/*','/healthz']};
