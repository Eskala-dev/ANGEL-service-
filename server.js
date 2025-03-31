import express from 'express';
import http from 'http';
import cors from 'cors';
import { PORT } from './server/config/config.js';

import { connectDB } from './server/config/db.js';
import socketServer from './server/socket/socketServer.js';

import facturaRoutes from './server/routes/Factura.js';
import codFacturaRoutes from './server/routes/codigoFactura.js';
import anularRoutes from './server/routes/anular.js';
import gastoRoutes from './server/routes/gastos.js';
import cuadreDiarioRoutes from './server/routes/cuadreDiario.js';
import clientesRoutes from './server/routes/clientes.js';
import puntosRoutes from './server/routes/puntos.js';
import impuestoRoutes from './server/routes/impuesto.js';
import usuariosRoutes from './server/routes/usuarios.js';
import reportesRoutes from './server/routes/reportes.js';
import promocionesRoutes from './server/routes/promociones.js';
import cuponesRoutes from './server/routes/cupones.js';
import almacenRoutes from './server/routes/almacen.js';
import metasRoutes from './server/routes/metas.js';
import donacionRoutes from './server/routes/docacion.js';
import negocioRoutes from './server/routes/negocio.js';
import categoriasRoutes from './server/routes/categorias.js';
import productosRoutes from './server/routes/portafolio/productos/productos.js';
import serviciosRoutes from './server/routes/portafolio/servicios.js';
import portafolioRoutes from './server/routes/portafolio/portafolio.js';
import pagosRoutes from './server/routes/pagos.js';
import tipoGastosRoutes from './server/routes/tipoGasto.js';
import asistenciaRoutes from './server/routes/personal/asistencia.js';
import personalRoutes from './server/routes/personal/personal.js';
import rolesPersonalRoutes from './server/routes/personal/rolPersonal.js';
import movimientoProductoRoutes from './server/routes/portafolio/productos/movimientosProducto.js';
import insumosRoutes from './server/routes/portafolio/insumos/insumos.js';
import movimientoInsumoRoutes from './server/routes/portafolio/insumos/movimientosInsumo.js';
import counterStockRoutes from './server/routes/portafolio/counterStock.js';

import { timeZone } from './server/utils/varsGlobal.js';
import moment from 'moment';
import 'moment/locale/es.js';
import 'moment-timezone';
import 'moment-timezone/builds/moment-timezone-with-data.js';

connectDB();

const app = express();

moment.tz.setDefault(timeZone);

const server = http.createServer(app);

socketServer(server);

app.use(
  cors({
    origin: '*',
  })
);

app.use(express.json());

// Rutas
// Factura
app.use('/api/lava-ya/', facturaRoutes);
// Codigo
app.use('/api/lava-ya/', codFacturaRoutes);
// Anular
app.use('/api/lava-ya/', anularRoutes);
// Gasto
app.use('/api/lava-ya/', gastoRoutes);
// Cuadre Diario
app.use('/api/lava-ya/', cuadreDiarioRoutes);
// Clientes
app.use('/api/lava-ya/', clientesRoutes);
// Puntos
app.use('/api/lava-ya/', puntosRoutes);
// Impuesto
app.use('/api/lava-ya/', impuestoRoutes);
// Usuarios
app.use('/api/lava-ya/', usuariosRoutes);
// Reportes
app.use('/api/lava-ya/', reportesRoutes);
// Promociones
app.use('/api/lava-ya/', promocionesRoutes);
// Cupones
app.use('/api/lava-ya/', cuponesRoutes);
// Almacen
app.use('/api/lava-ya/', almacenRoutes);
// Metas
app.use('/api/lava-ya/', metasRoutes);
// Donacion
app.use('/api/lava-ya/', donacionRoutes);
// Negocio
app.use('/api/lava-ya/', negocioRoutes);
// Categorias
app.use('/api/lava-ya/', categoriasRoutes);
// Productos
app.use('/api/lava-ya/', productosRoutes);
// Servicios
app.use('/api/lava-ya/', serviciosRoutes);
// Portafolio
app.use('/api/lava-ya/', portafolioRoutes);
// Pagos
app.use('/api/lava-ya/', pagosRoutes);
// TipoGastos
app.use('/api/lava-ya/', tipoGastosRoutes);
// Asistencia
app.use('/api/lava-ya/', asistenciaRoutes);
// Personal
app.use('/api/lava-ya/', personalRoutes);
// Rol Personal
app.use('/api/lava-ya/', rolesPersonalRoutes);
// Movimiento de Producto
app.use('/api/lava-ya/', movimientoProductoRoutes);
// Insumos
app.use('/api/lava-ya/', insumosRoutes);
// Movimiento de Insumo
app.use('/api/lava-ya/', movimientoInsumoRoutes);
// Conteo de Stock de Portafolio
app.use('/api/lava-ya/', counterStockRoutes);

server.listen(PORT, () => {
  console.log('Server Iniciado en puerto: ' + PORT);
});

app.get('/', (req, res) => {
  // Aquí puedes definir el HTML que quieres enviar como respuesta
  const htmlResponse = `
    <html>
      <head>
        <title>Estado del Servidor</title>
      </head>
      <body>
        <h1>Estado del Servidor</h1>
        <p>El servidor está funcionando correctamente.</p>
      </body>
    </html>
  `;

  // Envía el HTML como respuesta
  res.send(htmlResponse);
});
