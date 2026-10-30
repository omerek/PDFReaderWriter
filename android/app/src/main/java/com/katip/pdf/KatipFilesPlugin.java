package com.katip.pdf;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Android side of Katip PDF's file handling: system file picker (Storage Access Framework),
 * reading and writing documents, sharing, printing and PDFs opened from other apps.
 *
 * Bytes coming from the web view are first staged in a temporary file in chunks (stageChunk),
 * then copied to their destination in one go, so a failed transfer never truncates a document.
 */
@CapacitorPlugin(name = "KatipFiles")
public class KatipFilesPlugin extends Plugin {

    private static final String READ_ONLY = "READ_ONLY";
    private Intent pendingIntent;

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        if (documentUri(intent) != null) pendingIntent = intent;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        Uri uri = documentUri(intent);
        if (uri == null) return;
        notifyListeners("openUri", describe(uri), true);
    }

    private Uri documentUri(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) return intent.getData();
        if (Intent.ACTION_SEND.equals(action)) return intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return null;
    }

    @PluginMethod
    public void getPendingIntent(PluginCall call) {
        Intent intent = pendingIntent;
        pendingIntent = null;
        Uri uri = documentUri(intent);
        call.resolve(uri == null ? new JSObject() : describe(uri));
    }

    // ------------------------------------------------------------------ pickers

    @PluginMethod
    public void openDocuments(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        JSArray types = call.getArray("mimeTypes", new JSArray());
        String[] mimeTypes = new String[types.length()];
        for (int i = 0; i < types.length(); i++) mimeTypes[i] = types.optString(i, "*/*");
        if (mimeTypes.length == 1) {
            intent.setType(mimeTypes[0]);
        } else {
            intent.setType("*/*");
            if (mimeTypes.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        }
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.getBoolean("multi", false));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "openResult");
    }

    @ActivityCallback
    private void openResult(PluginCall call, ActivityResult result) {
        JSArray files = new JSArray();
        Intent data = result.getData();
        if (result.getResultCode() == android.app.Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) files.put(keep(clip.getItemAt(i).getUri()));
            } else if (data.getData() != null) {
                files.put(keep(data.getData()));
            }
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    @PluginMethod
    public void createDocument(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/pdf"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Belge.pdf"));
        startActivityForResult(call, intent, "createResult");
    }

    @ActivityCallback
    private void createResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        call.resolve(keep(data.getData()));
    }

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "directoryResult");
    }

    @ActivityCallback
    private void directoryResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        Uri uri = data.getData();
        persist(uri);
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        call.resolve(ret);
    }

    // ------------------------------------------------------------------ reading / writing

    @PluginMethod
    public void readFile(PluginCall call) {
        try (InputStream in = resolver().openInputStream(Uri.parse(call.getString("uri")))) {
            if (in == null) throw new IOException("Dosya açılamadı");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            copy(in, out);
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Dosya okunamadı: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stageChunk(PluginCall call) {
        File file = stagedFile(call.getString("id"));
        if (file == null) {
            call.reject("Geçersiz kimlik");
            return;
        }
        try (OutputStream out = new FileOutputStream(file, call.getBoolean("append", false))) {
            String data = call.getString("data", "");
            if (!data.isEmpty()) out.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("Veri aktarılamadı: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void commit(PluginCall call) {
        File file = stagedFile(call.getString("id"));
        if (file == null || !file.exists()) {
            call.reject("Kaydedilecek veri bulunamadı.");
            return;
        }
        Uri uri = Uri.parse(call.getString("uri"));
        OutputStream out = null;
        for (String mode : new String[] { "wt", "rwt" }) {
            try {
                out = resolver().openOutputStream(uri, mode);
                if (out != null) break;
            } catch (Exception ignored) {
                // try the next mode; some providers only support one of them
            }
        }
        if (out == null) {
            file.delete();
            call.reject("Bu dosyaya yazma izni yok.", READ_ONLY);
            return;
        }
        try (InputStream in = new FileInputStream(file); OutputStream o = out) {
            copy(in, o);
            call.resolve();
        } catch (Exception e) {
            call.reject("Kaydedilemedi: " + e.getMessage(), e);
        } finally {
            file.delete();
        }
    }

    @PluginMethod
    public void commitToDirectory(PluginCall call) {
        File file = stagedFile(call.getString("id"));
        try {
            Uri tree = Uri.parse(call.getString("treeUri"));
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            Uri doc = DocumentsContract.createDocument(resolver(), parent, call.getString("mime", "application/octet-stream"), call.getString("name"));
            if (doc == null) throw new IOException("Dosya oluşturulamadı");
            try (InputStream in = new FileInputStream(file); OutputStream out = resolver().openOutputStream(doc, "w")) {
                if (out == null) throw new IOException("Dosya yazılamadı");
                copy(in, out);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Kaydedilemedi: " + e.getMessage(), e);
        } finally {
            if (file != null) file.delete();
        }
    }

    // ------------------------------------------------------------------ share / print / look

    @PluginMethod
    public void share(PluginCall call) {
        File staged = stagedFile(call.getString("id"));
        try {
            File dir = new File(getContext().getCacheDir(), "paylas");
            deleteChildren(dir);
            dir.mkdirs();
            File target = new File(dir, safeName(call.getString("name", "Belge.pdf")));
            if (!staged.renameTo(target)) throw new IOException("Geçici dosya taşınamadı");
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", target);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "application/pdf"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri(target.getName(), uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, "Paylaş"));
            call.resolve();
        } catch (Exception e) {
            call.reject("Paylaşılamadı: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        File file = stagedFile(call.getString("id"));
        String name = safeName(call.getString("name", "Belge.pdf"));
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                pm.print(name, new PdfPrintAdapter(file, name), new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                call.reject("Yazdırılamadı: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void setBackground(PluginCall call) {
        String color = call.getString("color", "#f3f4f6");
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().getWindow().getDecorView().setBackgroundColor(Color.parseColor(color));
            } catch (Exception ignored) {
                // cosmetic only
            }
            call.resolve();
        });
    }

    private static class PdfPrintAdapter extends PrintDocumentAdapter {
        private final File file;
        private final String name;

        PdfPrintAdapter(File file, String name) {
            this.file = file;
            this.name = name;
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal cancel, LayoutResultCallback callback, Bundle extras) {
            if (cancel.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build();
            callback.onLayoutFinished(info, true);
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal cancel, WriteResultCallback callback) {
            try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                copy(in, out);
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (Exception e) {
                callback.onWriteFailed(e.getMessage());
            }
        }

        @Override
        public void onFinish() {
            file.delete();
        }
    }

    // ------------------------------------------------------------------ helpers

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private File stagedFile(String id) {
        if (id == null || !id.matches("[A-Za-z0-9]+")) return null;
        File dir = new File(getContext().getCacheDir(), "staged");
        dir.mkdirs();
        return new File(dir, id);
    }

    private void persist(Uri uri) {
        try {
            resolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            try {
                resolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
                // not every provider offers persistable permissions
            }
        }
    }

    private JSObject keep(Uri uri) {
        persist(uri);
        return describe(uri);
    }

    private JSObject describe(Uri uri) {
        String name = null;
        String mime = null;
        try {
            mime = resolver().getType(uri);
        } catch (Exception ignored) {
            // unknown type
        }
        try (Cursor c = resolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
        } catch (Exception ignored) {
            // fall back to the uri below
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "Belge";
        name = safeName(name);
        if (!name.contains(".") && mime != null) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null) name = name + "." + ext;
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", name);
        return ret;
    }

    private static String safeName(String name) {
        String n = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return n.isEmpty() ? "Belge.pdf" : n;
    }

    private static void deleteChildren(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) f.delete();
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }
}
