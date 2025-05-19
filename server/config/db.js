import mongoose from 'mongoose';
import { idCluster, nameDB, passDB, userDB } from '../utils/varsGlobal.js';

export const connectDB = async () => {
  const uri = `mongodb+srv://${userDB}:${passDB}@${idCluster}.mongodb.net/${nameDB}?retryWrites=true&w=majority`;

  try {
    console.log(uri);
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Conexión exitosa a MongoDB');
  } catch (error) {
    console.error('Error al conectar a MongoDB:', error);
    process.exit(1); // Terminar el proceso con error
  }
};

export default mongoose;
