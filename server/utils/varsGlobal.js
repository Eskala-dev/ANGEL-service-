import dotenv from 'dotenv';
dotenv.config();

export const userDB = process.env.USER_DB;
export const passDB = process.env.PASS_DB;
export const idCluster = process.env.ID_CLUSTER;
export const nameDB = process.env.NAME_DB;

export const nameCliente = process.env.NAME_CLIENTE;
export const emailBusiness = process.env.DIRECCION_EMAIL;
export const passBusiness = process.env.PASS_EMAIL;
export const secretKey = process.env.SECRET_KEY;
export const timeZone = process.env.TIME_ZONE;
export const PORT = process.env.PORT || 3001;
export const nameDelivery = 'Servicio a Domicilio';
