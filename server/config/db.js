import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    await mongoose.connect(
      'mongodb+srv://eskaladev:shfxE76ZRS7GW0YT@instancian5.1maapo0.mongodb.net/db-antonio?retryWrites=true&w=majority&appName=InstanciaN5',
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }
    );
    console.log('Conexión exitosa a MongoDB');
  } catch (error) {
    console.error('Error al conectar a MongoDB:', error);
    process.exit(1); // Terminar el proceso con error
  }
};

export default mongoose;
