import mongoose from 'mongoose';

const RolPersonalSchema = new mongoose.Schema(
  {
    nombre: String,
  },
  { collection: 'RolPersonal' }
);

const RolPersonal = mongoose.model('RolPersonal', RolPersonalSchema);

export default RolPersonal;
