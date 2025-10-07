// Sistema de respaldo automático de datos
class BackupSystem {
  constructor() {
    this.backupInterval = 5 * 60 * 1000; // 5 minutos
    this.maxBackups = 10;
    this.isEnabled = true;
    this.init();
  }

  init() {
    if (!this.isEnabled) return;
    
    // Iniciar respaldo automático
    this.startAutoBackup();
    
    // Respaldo al cerrar la ventana
    window.addEventListener('beforeunload', () => {
      this.createBackup('manual');
    });
    
    // Respaldo al cambiar de pestaña
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.createBackup('visibility');
      }
    });
  }

  startAutoBackup() {
    setInterval(() => {
      this.createBackup('auto');
    }, this.backupInterval);
    
    // Primer respaldo inmediato
    setTimeout(() => {
      this.createBackup('initial');
    }, 1000);
  }

  createBackup(type = 'manual') {
    try {
      const timestamp = new Date().toISOString();
      const backupData = {
        timestamp,
        type,
        data: {
          orders: this.getOrders(),
          collaborators: this.getCollaborators(),
          services: this.getServices(),
          vehicles: this.getVehicles(),
          settings: this.getSettings()
        },
        version: '1.0.0'
      };

      // Guardar respaldo
      const backupKey = `tlc_backup_${Date.now()}`;
      localStorage.setItem(backupKey, JSON.stringify(backupData));
      
      // Limpiar respaldos antiguos
      this.cleanOldBackups();
      
      console.log(`✅ Respaldo creado: ${type} - ${timestamp}`);
      
      return backupKey;
    } catch (error) {
      console.error('❌ Error al crear respaldo:', error);
      return null;
    }
  }

  getOrders() {
    try {
      return JSON.parse(localStorage.getItem('tlc_orders') || '[]');
    } catch {
      return [];
    }
  }

  getCollaborators() {
    try {
      return JSON.parse(localStorage.getItem('tlc_collaborators') || '[]');
    } catch {
      return [];
    }
  }

  getServices() {
    try {
      return JSON.parse(localStorage.getItem('tlc_services') || '[]');
    } catch {
      return [];
    }
  }

  getVehicles() {
    try {
      return JSON.parse(localStorage.getItem('tlc_vehicles') || '[]');
    } catch {
      return [];
    }
  }

  getSettings() {
    try {
      const settings = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('tlc_') && !key.includes('backup')) {
          settings[key] = localStorage.getItem(key);
        }
      }
      return settings;
    } catch {
      return {};
    }
  }

  cleanOldBackups() {
    try {
      const backupKeys = [];
      
      // Obtener todas las claves de respaldo
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('tlc_backup_')) {
          backupKeys.push({
            key,
            timestamp: parseInt(key.split('_')[2])
          });
        }
      }
      
      // Ordenar por timestamp (más reciente primero)
      backupKeys.sort((a, b) => b.timestamp - a.timestamp);
      
      // Eliminar respaldos antiguos
      if (backupKeys.length > this.maxBackups) {
        const toDelete = backupKeys.slice(this.maxBackups);
        toDelete.forEach(backup => {
          localStorage.removeItem(backup.key);
          console.log(`🗑️ Respaldo eliminado: ${backup.key}`);
        });
      }
    } catch (error) {
      console.error('❌ Error al limpiar respaldos:', error);
    }
  }

  listBackups() {
    const backups = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('tlc_backup_')) {
        try {
          const backup = JSON.parse(localStorage.getItem(key));
          backups.push({
            key,
            timestamp: backup.timestamp,
            type: backup.type,
            size: JSON.stringify(backup).length
          });
        } catch (error) {
          console.error(`❌ Error al leer respaldo ${key}:`, error);
        }
      }
    }
    
    return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  restoreBackup(backupKey) {
    try {
      const backupData = JSON.parse(localStorage.getItem(backupKey));
      if (!backupData) {
        throw new Error('Respaldo no encontrado');
      }
      
      const { data } = backupData;
      
      // Restaurar datos
      if (data.orders) {
        localStorage.setItem('tlc_orders', JSON.stringify(data.orders));
      }
      
      if (data.collaborators) {
        localStorage.setItem('tlc_collaborators', JSON.stringify(data.collaborators));
      }
      
      if (data.services) {
        localStorage.setItem('tlc_services', JSON.stringify(data.services));
      }
      
      if (data.vehicles) {
        localStorage.setItem('tlc_vehicles', JSON.stringify(data.vehicles));
      }
      
      if (data.settings) {
        Object.entries(data.settings).forEach(([key, value]) => {
          localStorage.setItem(key, value);
        });
      }
      
      console.log(`✅ Respaldo restaurado: ${backupKey}`);
      
      // Recargar página para aplicar cambios
      if (confirm('Respaldo restaurado correctamente. ¿Desea recargar la página para aplicar los cambios?')) {
        window.location.reload();
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error al restaurar respaldo:', error);
      return false;
    }
  }

  exportBackup(backupKey) {
    try {
      const backupData = localStorage.getItem(backupKey);
      if (!backupData) {
        throw new Error('Respaldo no encontrado');
      }
      
      const blob = new Blob([backupData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `tlc_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      URL.revokeObjectURL(url);
      
      console.log(`📥 Respaldo exportado: ${backupKey}`);
      return true;
    } catch (error) {
      console.error('❌ Error al exportar respaldo:', error);
      return false;
    }
  }

  importBackup(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const backupData = JSON.parse(e.target.result);
          
          // Validar estructura del respaldo
          if (!backupData.data || !backupData.timestamp) {
            throw new Error('Formato de respaldo inválido');
          }
          
          // Crear clave única para el respaldo importado
          const backupKey = `tlc_backup_imported_${Date.now()}`;
          localStorage.setItem(backupKey, JSON.stringify(backupData));
          
          console.log(`📤 Respaldo importado: ${backupKey}`);
          resolve(backupKey);
        } catch (error) {
          console.error('❌ Error al importar respaldo:', error);
          reject(error);
        }
      };
      
      reader.onerror = () => {
        reject(new Error('Error al leer el archivo'));
      };
      
      reader.readAsText(file);
    });
  }

  getStorageUsage() {
    let totalSize = 0;
    let backupSize = 0;
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      const size = (key.length + value.length) * 2; // Aproximación en bytes
      
      totalSize += size;
      
      if (key.startsWith('tlc_backup_')) {
        backupSize += size;
      }
    }
    
    return {
      total: this.formatBytes(totalSize),
      backups: this.formatBytes(backupSize),
      percentage: totalSize > 0 ? ((backupSize / totalSize) * 100).toFixed(1) : 0
    };
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  enable() {
    this.isEnabled = true;
    this.startAutoBackup();
    console.log('✅ Sistema de respaldo habilitado');
  }

  disable() {
    this.isEnabled = false;
    console.log('⏸️ Sistema de respaldo deshabilitado');
  }
}

// Inicializar sistema de respaldo
const backupSystem = new BackupSystem();

// Exponer funciones globales para uso en consola
window.tlcBackup = {
  create: () => backupSystem.createBackup('manual'),
  list: () => backupSystem.listBackups(),
  restore: (key) => backupSystem.restoreBackup(key),
  export: (key) => backupSystem.exportBackup(key),
  usage: () => backupSystem.getStorageUsage(),
  enable: () => backupSystem.enable(),
  disable: () => backupSystem.disable()
};

console.log('🔄 Sistema de respaldo automático inicializado');
console.log('💡 Usa tlcBackup en la consola para gestionar respaldos manualmente');