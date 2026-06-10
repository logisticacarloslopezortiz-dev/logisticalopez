/**
 * UploadQueue: Gestiona la subida de fotos de evidencia en segundo plano.
 * Permite que el chofer siga operando sin esperar a que las fotos pesadas terminen.
 */
class UploadQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.listeners = [];
    }

    /**
     * Añade un archivo a la cola.
     * @param {File} file 
     * @param {Object} context { orderId, phase, bucket }
     */
    add(file, context) {
        const item = {
            id: Math.random().toString(36).substr(2, 9),
            file,
            context,
            status: 'pending',
            progress: 0,
            error: null,
            retries: 0
        };
        this.queue.push(item);
        this.notify();
        this.process();
        return item.id;
    }

    async process() {
        if (this.isProcessing || this.queue.length === 0) return;

        const item = this.queue.find(i => i.status === 'pending' || i.status === 'error' && i.retries < 3);
        if (!item) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        item.status = 'uploading';
        this.notify();

        try {
            const { file, context } = item;
            const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const path = `${context.orderId}/${Date.now()}-${safeName}`;

            // 1. Subir a Storage
            const { error: upErr } = await supabaseConfig.client.storage
                .from(context.bucket)
                .upload(path, file, { contentType: file.type, upsert: true });

            if (upErr) throw upErr;

            const { data: pub } = supabaseConfig.client.storage.from(context.bucket).getPublicUrl(path);
            const url = pub?.publicUrl || '';

            // 2. Actualizar la orden en la DB (usando RPC para evitar race conditions)
            const { error: updErr } = await supabaseConfig.client.rpc('append_order_evidence', {
                p_order_id: context.orderId,
                p_evidence: { bucket: context.bucket, path, url }
            });

            if (updErr) throw updErr;

            item.status = 'completed';
            item.progress = 100;
        } catch (err) {
            console.error('UploadQueue Error:', err);
            item.status = 'error';
            item.error = err.message;
            item.retries++;
        } finally {
            this.isProcessing = false;
            this.notify();
            // Procesar siguiente tras un pequeño delay
            setTimeout(() => this.process(), 500);
        }
    }

    onUpdate(callback) {
        this.listeners.push(callback);
    }

    notify() {
        this.listeners.forEach(cb => cb([...this.queue]));
    }

    getPendingCount() {
        return this.queue.filter(i => i.status === 'uploading' || i.status === 'pending').length;
    }
}

window.uploadQueue = new UploadQueue();
