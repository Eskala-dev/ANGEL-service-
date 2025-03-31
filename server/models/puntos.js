import mongoose from 'mongoose';

const puntosSchema = new mongoose.Schema(
  {
    score: String,
    valor: String,
    useState: Boolean,
    showPuntosByDefault: Boolean,
  },
  { collection: 'Puntos' }
);

const Puntos = mongoose.model('Puntos', puntosSchema);

export default Puntos;
