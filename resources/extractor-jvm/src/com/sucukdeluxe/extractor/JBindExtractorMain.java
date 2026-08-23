package com.sucukdeluxe.extractor;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.exception.ZipException;
import net.lingala.zip4j.model.FileHeader;
import net.lingala.zip4j.model.enums.EncryptionMethod;
import net.sf.sevenzipjbinding.ExtractAskMode;
import net.sf.sevenzipjbinding.ExtractOperationResult;
import net.sf.sevenzipjbinding.IArchiveExtractCallback;
import net.sf.sevenzipjbinding.IArchiveOpenCallback;
import net.sf.sevenzipjbinding.IArchiveOpenVolumeCallback;
import net.sf.sevenzipjbinding.IInArchive;
import net.sf.sevenzipjbinding.IInStream;
import net.sf.sevenzipjbinding.ISequentialOutStream;
import net.sf.sevenzipjbinding.ICryptoGetTextPassword;
import net.sf.sevenzipjbinding.PropID;
import net.sf.sevenzipjbinding.SevenZip;
import net.sf.sevenzipjbinding.SevenZipException;
import net.sf.sevenzipjbinding.impl.RandomAccessFileInStream;
import net.sf.sevenzipjbinding.impl.VolumedArchiveInStream;
import net.sf.sevenzipjbinding.simple.ISimpleInArchive;
import net.sf.sevenzipjbinding.simple.ISimpleInArchiveItem;

import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

public final class JBindExtractorMain {
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final Pattern NUMBERED_ZIP_SPLIT_RE = Pattern.compile("(?i).*\\.zip\\.\\d{3}$");
    private static final Pattern OLD_ZIP_SPLIT_RE = Pattern.compile("(?i).*\\.z\\d{2,3}$");
    private static final Pattern SEVEN_ZIP_SPLIT_RE = Pattern.compile("(?i).*\\.7z\\.001$");
    private static final Pattern DIGIT_SUFFIX_RE = Pattern.compile("\\d{2,3}");
    private static final Pattern WINDOWS_SPECIAL_CHARS_RE = Pattern.compile("[:<>*?\"\\|]");
    private static volatile boolean sevenZipInitialized = false;

    private JBindExtractorMain() {
    }

    public static void main(String[] args) {
        if (args.length == 1 && "--daemon".equals(args[0])) {
            runDaemon();
            return;
        }
        int exit = 1;
        try {
            ExtractionRequest request = parseArgs(args);
            exit = runExtraction(request);
        } catch (IllegalArgumentException error) {
            emitError("Argumentfehler: " + safeMessage(error));
            exit = 2;
        } catch (Throwable error) {
            emitError(safeMessage(error));
            exit = 1;
        }
        System.exit(exit);
    }

    private static void runDaemon() {
        System.out.println("RD_DAEMON_READY");
        System.out.flush();
        java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(System.in, StandardCharsets.UTF_8));
        try {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) {
                    continue;
                }
                int exitCode = 1;
                try {
                    ExtractionRequest request = parseDaemonRequest(line);
                    exitCode = runExtraction(request);
                } catch (IllegalArgumentException error) {
                    emitError("Argumentfehler: " + safeMessage(error));
                    exitCode = 2;
                } catch (Throwable error) {
                    emitError(safeMessage(error));
                    exitCode = 1;
                }
                System.out.println("RD_REQUEST_DONE " + exitCode);
                System.out.flush();
            }
        } catch (IOException ignored) {

        }
    }

    private static ExtractionRequest parseDaemonRequest(String jsonLine) {
        Map<String, Object> values = new DaemonJsonParser(jsonLine).parseObject();
        ExtractionRequest request = new ExtractionRequest();
        request.archiveFile = new File(requireJsonString(values, "archive"));
        request.targetDir = new File(requireJsonString(values, "target"));
        String conflict = optionalJsonString(values, "conflict");
        if (conflict.length() > 0) {
            request.conflictMode = ConflictMode.fromValue(conflict);
        }
        String backend = optionalJsonString(values, "backend");
        if (backend.length() > 0) {
            request.backend = Backend.fromValue(backend);
        }
        Object rawPasswords = values.get("passwords");
        if (rawPasswords != null) {
            if (!(rawPasswords instanceof List<?>)) {
                throw new IllegalArgumentException("Daemon-Feld passwords muss ein String-Array sein");
            }
            for (Object value : (List<?>) rawPasswords) {
                if (!(value instanceof String)) {
                    throw new IllegalArgumentException("Daemon-Feld passwords muss nur Strings enthalten");
                }
                request.passwords.add((String) value);
            }
        }
        if (request.archiveFile == null || !request.archiveFile.exists() || !request.archiveFile.isFile()) {
            throw new IllegalArgumentException("Archiv nicht gefunden: " +
                    (request.archiveFile == null ? "null" : request.archiveFile.getAbsolutePath()));
        }
        if (request.targetDir == null) {
            throw new IllegalArgumentException("--target fehlt");
        }
        return request;
    }

    private static String requireJsonString(Map<String, Object> values, String key) {
        String value = optionalJsonString(values, key);
        if (value.length() == 0) {
            throw new IllegalArgumentException("Daemon-Feld fehlt: " + key);
        }
        return value;
    }

    private static String optionalJsonString(Map<String, Object> values, String key) {
        Object value = values.get(key);
        if (value == null) {
            return "";
        }
        if (!(value instanceof String)) {
            throw new IllegalArgumentException("Daemon-Feld muss ein String sein: " + key);
        }
        return (String) value;
    }

    private static final class DaemonJsonParser {
        private final String input;
        private int index;

        DaemonJsonParser(String input) {
            this.input = input == null ? "" : input;
        }

        Map<String, Object> parseObject() {
            skipWhitespace();
            expect('{');
            Map<String, Object> values = new HashMap<String, Object>();
            skipWhitespace();
            if (consume('}')) {
                requireEnd();
                return values;
            }
            while (true) {
                String key = parseString();
                skipWhitespace();
                expect(':');
                skipWhitespace();
                Object value = peek('"') ? parseString() : parseStringArray();
                if (values.containsKey(key)) {
                    throw malformed();
                }
                values.put(key, value);
                skipWhitespace();
                if (consume('}')) {
                    requireEnd();
                    return values;
                }
                expect(',');
                skipWhitespace();
            }
        }

        private List<String> parseStringArray() {
            expect('[');
            List<String> values = new ArrayList<String>();
            skipWhitespace();
            if (consume(']')) {
                return values;
            }
            while (true) {
                values.add(parseString());
                skipWhitespace();
                if (consume(']')) {
                    return values;
                }
                expect(',');
                skipWhitespace();
            }
        }

        private String parseString() {
            expect('"');
            StringBuilder value = new StringBuilder();
            while (index < input.length()) {
                char current = input.charAt(index++);
                if (current == '"') {
                    return value.toString();
                }
                if (current < 0x20) {
                    throw malformed();
                }
                if (current != '\\') {
                    value.append(current);
                    continue;
                }
                if (index >= input.length()) {
                    throw malformed();
                }
                char escaped = input.charAt(index++);
                switch (escaped) {
                    case '"': value.append('"'); break;
                    case '\\': value.append('\\'); break;
                    case '/': value.append('/'); break;
                    case 'b': value.append('\b'); break;
                    case 'f': value.append('\f'); break;
                    case 'n': value.append('\n'); break;
                    case 'r': value.append('\r'); break;
                    case 't': value.append('\t'); break;
                    case 'u': value.append(parseUnicodeEscape()); break;
                    default: throw malformed();
                }
            }
            throw malformed();
        }

        private char parseUnicodeEscape() {
            if (index + 4 > input.length()) {
                throw malformed();
            }
            int value = 0;
            for (int offset = 0; offset < 4; offset += 1) {
                int digit = Character.digit(input.charAt(index++), 16);
                if (digit < 0) {
                    throw malformed();
                }
                value = (value << 4) | digit;
            }
            return (char) value;
        }

        private void requireEnd() {
            skipWhitespace();
            if (index != input.length()) {
                throw malformed();
            }
        }

        private void skipWhitespace() {
            while (index < input.length()) {
                char current = input.charAt(index);
                if (current != ' ' && current != '\t' && current != '\r' && current != '\n') {
                    return;
                }
                index += 1;
            }
        }

        private boolean peek(char expected) {
            return index < input.length() && input.charAt(index) == expected;
        }

        private boolean consume(char expected) {
            if (!peek(expected)) {
                return false;
            }
            index += 1;
            return true;
        }

        private void expect(char expected) {
            if (!consume(expected)) {
                throw malformed();
            }
        }

        private IllegalArgumentException malformed() {
            return new IllegalArgumentException("Ungueltige Daemon-JSON-Anfrage");
        }
    }

    private static int runExtraction(ExtractionRequest request) throws Exception {
        List<String> passwords = normalizePasswords(request.passwords);
        Exception lastError = null;
        Exception integrityError = null;
        boolean hadWrongPassword = false;
        for (int passwordIndex = 0; passwordIndex < passwords.size(); passwordIndex++) {
            String password = passwords.get(passwordIndex);
            emitPasswordAttempt(passwordIndex + 1, passwords.size());
            try {
                extractSingle(request, password);
                emitDone();
                return 0;
            } catch (AmbiguousPasswordOrIntegrityException ambiguous) {
                integrityError = ambiguous;
                lastError = ambiguous;
            } catch (WrongPasswordException wrongPassword) {
                hadWrongPassword = true;
                lastError = wrongPassword;
            } catch (Exception error) {
                integrityError = null;
                lastError = error;
                break;
            }
        }

        if (integrityError != null) {
            throw integrityError;
        }
        if (hadWrongPassword && (lastError instanceof WrongPasswordException)) {
            emitError("Falsches Archiv-Passwort");
            return 1;
        }
        if (lastError != null) {
            throw lastError;
        }
        emitError("Entpacken fehlgeschlagen");
        return 1;
    }

    private static void extractSingle(ExtractionRequest request, String password) throws Exception {
        Backend backend = request.backend;
        if (backend == Backend.AUTO) {
            backend = shouldUseZip4j(request.archiveFile) ? Backend.ZIP4J : Backend.SEVENZIPJBIND;
        }
        emitBackend(backend);

        if (backend == Backend.ZIP4J) {
            extractWithZip4j(request, password);
            return;
        }
        extractWithSevenZip(request, password);
    }

    private static void extractWithZip4j(ExtractionRequest request, String password) throws Exception {
        ZipFile zipFile = new ZipFile(request.archiveFile);
        try {
            if (password != null && password.length() > 0) {
                zipFile.setPassword(password.toCharArray());
            }

            List<FileHeader> fileHeaders = zipFile.getFileHeaders();
            if (fileHeaders == null) {
                fileHeaders = new ArrayList<FileHeader>();
            }

            RawArchivePlanInvariant rawPlan = new RawArchivePlanInvariant();
            for (FileHeader header : fileHeaders) {
                if (header == null) {
                    continue;
                }
                String entryName = normalizeEntryName(header.getFileName(), "file");
                if (header.isDirectory()) {
                    resolveDirectory(request.targetDir, entryName);
                } else {
                    secureResolve(request.targetDir, entryName);
                }
                rawPlan.add(entryName, header.isDirectory());
            }

            long totalUnits = 0;
            boolean encrypted = false;
            for (FileHeader header : fileHeaders) {
                if (header == null || header.isDirectory()) {
                    continue;
                }
                encrypted = encrypted || header.isEncrypted();
                totalUnits += safeSize(header.getUncompressedSize());
            }
            if (encrypted) {
                for (FileHeader header : fileHeaders) {
                    if (header == null || header.isDirectory() || !header.isEncrypted()) {
                        continue;
                    }
                    InputStream passwordProbe = null;
                    try {
                        passwordProbe = zipFile.getInputStream(header);
                    } catch (ZipException error) {
                        if (isWrongPassword(error, true, false)) {
                            throw new WrongPasswordException(error);
                        }
                        throw error;
                    } finally {
                        if (passwordProbe != null) {
                            try {
                                passwordProbe.close();
                            } catch (Throwable ignored) {
                            }
                        }
                    }
                }
            }
            Set<String> reserved = new HashSet<String>();
            TargetPlanInvariant targetPlan = new TargetPlanInvariant();
            Map<FileHeader, String> plannedEntryNames = new IdentityHashMap<FileHeader, String>();
            Map<FileHeader, File> plannedDirectories = new IdentityHashMap<FileHeader, File>();
            Map<FileHeader, OutputTarget> plannedOutputs = new IdentityHashMap<FileHeader, OutputTarget>();
            for (FileHeader header : fileHeaders) {
                if (header == null) {
                    continue;
                }
                String entryName = normalizeEntryName(header.getFileName(), "file");
                plannedEntryNames.put(header, entryName);
                if (header.isDirectory()) {
                    File dir = resolveDirectory(request.targetDir, entryName);
                    targetPlan.add(dir, true);
                    reserved.add(pathKey(dir));
                    plannedDirectories.put(header, dir);
                } else {
                    OutputTarget outputTarget = resolveOutputFile(request.targetDir, entryName, request.conflictMode, reserved);
                    targetPlan.add(outputTarget.reportedFile, false);
                    plannedOutputs.put(header, outputTarget);
                }
            }

            ProgressTracker progress = new ProgressTracker(totalUnits);
            progress.emitStart();

            for (FileHeader header : fileHeaders) {
                if (header == null) {
                    continue;
                }

                String entryName = plannedEntryNames.get(header);
                if (header.isDirectory()) {
                    File dir = plannedDirectories.get(header);
                    ensureDirectory(dir);
                    rejectLinkedPath(request.targetDir, dir);
                    continue;
                }

                long itemUnits = safeSize(header.getUncompressedSize());
                OutputTarget outputTarget = plannedOutputs.get(header);
                File output = outputTarget.file;
                if (output == null) {
                    emitOutput(request.archiveFile, entryName, outputTarget.reportedFile, "complete", outputTarget.disposition);
                    progress.advance(itemUnits);
                    continue;
                }

                rejectLinkedPath(request.targetDir, output);
                emitOutput(request.archiveFile, entryName, output, "opened", outputTarget.disposition);
                ensureDirectory(output.getParentFile());
                rejectLinkedPath(request.targetDir, output);
                long[] remaining = new long[] { itemUnits };
                boolean extractionSuccess = false;
                boolean outputProduced = false;
                try {
                    InputStream in = zipFile.getInputStream(header);
                    try {
                        OutputStream out = new FileOutputStream(output);
                        try {
                            byte[] buffer = new byte[BUFFER_SIZE];
                            while (true) {
                                int read = in.read(buffer);
                                if (read < 0) {
                                    break;
                                }
                                if (read == 0) {
                                    continue;
                                }
                                out.write(buffer, 0, read);
                                outputProduced = true;
                                long accounted = Math.min(remaining[0], (long) read);
                                remaining[0] -= accounted;
                                progress.advance(accounted);
                            }
                        } finally {
                            try {
                                out.close();
                            } catch (Throwable ignored) {
                            }
                        }
                    } finally {
                        try {
                            in.close();
                        } catch (Throwable ignored) {
                        }
                    }
                    if (remaining[0] > 0) {
                        progress.advance(remaining[0]);
                    }
                    long modified = header.getLastModifiedTimeEpoch();
                    if (modified > 0) {
                        output.setLastModified(modified);
                    }
                    extractionSuccess = true;
                    emitOutput(request.archiveFile, entryName, output, "complete", outputTarget.disposition);
                } catch (ZipException error) {
                    if (isWrongPassword(error, encrypted, outputProduced)) {
                        throw new WrongPasswordException(error);
                    }
                    if (isZipIntegrityFailure(error, encrypted, outputProduced)) {
                        throw zipIntegrityFailure(header, error);
                    }
                    throw error;
                } catch (IOException error) {
                    if (isZipIntegrityFailure(error, encrypted, outputProduced)) {
                        throw zipIntegrityFailure(header, error);
                    }
                    throw error;
                } finally {
                    if (!extractionSuccess && output.exists()) {
                        if (output.delete()) {
                            emitOutput(request.archiveFile, entryName, output, "removed", outputTarget.disposition);
                        } else {
                            emitOutput(request.archiveFile, entryName, output, "partial", outputTarget.disposition);
                        }
                    }
                }
            }

            progress.emitDone();
        } finally {
            try {
                zipFile.close();
            } catch (Throwable ignored) {
            }
        }
    }

    private static synchronized void ensureSevenZipInitialized() throws Exception {
        if (sevenZipInitialized) {
            return;
        }
        SevenZip.initSevenZipFromPlatformJAR();
        sevenZipInitialized = true;
    }

    private static void extractWithSevenZip(ExtractionRequest request, String password) throws Exception {
        ensureSevenZipInitialized();
        SevenZipArchiveContext context = null;
        try {
            context = openSevenZipArchive(request.archiveFile, password);
            IInArchive archive = context.archive;
            Object rawArchiveError = archive.getArchiveProperty(PropID.ERROR);
            String archiveError = rawArchiveError == null ? "" : String.valueOf(rawArchiveError).trim();
            if (archiveError.length() > 0) {
                throw new IOException(archiveError);
            }
            int itemCount = archive.getNumberOfItems();
            if (itemCount <= 0) {
                throw new IOException("Archiv enthalt keine Eintrage oder konnte nicht gelesen werden: " + request.archiveFile.getAbsolutePath());
            }

            List<String> rawEntryNames = new ArrayList<String>();
            List<Boolean> rawEntryDirectories = new ArrayList<Boolean>();
            RawArchivePlanInvariant rawPlan = new RawArchivePlanInvariant();
            for (int i = 0; i < itemCount; i++) {
                Boolean isFolder = (Boolean) archive.getProperty(i, PropID.IS_FOLDER);
                String entryPath = (String) archive.getProperty(i, PropID.PATH);
                String entryName = normalizeEntryName(entryPath, "item-" + i);
                if (Boolean.TRUE.equals(isFolder)) {
                    resolveDirectory(request.targetDir, entryName);
                } else {
                    secureResolve(request.targetDir, entryName);
                }
                rawPlan.add(entryName, Boolean.TRUE.equals(isFolder));
                rawEntryNames.add(entryName);
                rawEntryDirectories.add(Boolean.valueOf(Boolean.TRUE.equals(isFolder)));
            }

            long totalUnits = 0;
            boolean encrypted = false;
            List<Integer> fileIndices = new ArrayList<Integer>();
            List<File> outputFiles = new ArrayList<File>();
            List<File> reportedFiles = new ArrayList<File>();
            List<Long> fileSizes = new ArrayList<Long>();
            List<String> entryNames = new ArrayList<String>();
            List<String> dispositions = new ArrayList<String>();
            List<File> outputDirectories = new ArrayList<File>();
            Set<String> reserved = new HashSet<String>();
            TargetPlanInvariant targetPlan = new TargetPlanInvariant();

            for (int i = 0; i < itemCount; i++) {
                Boolean isFolder = rawEntryDirectories.get(i);
                String entryName = rawEntryNames.get(i);

                if (Boolean.TRUE.equals(isFolder)) {
                    File dir = resolveDirectory(request.targetDir, entryName);
                    targetPlan.add(dir, true);
                    outputDirectories.add(dir);
                    reserved.add(pathKey(dir));
                    continue;
                }

                try {
                    Boolean isEncrypted = (Boolean) archive.getProperty(i, PropID.ENCRYPTED);
                    encrypted = encrypted || Boolean.TRUE.equals(isEncrypted);
                } catch (Throwable ignored) {

                }

                Long rawSize = (Long) archive.getProperty(i, PropID.SIZE);
                long itemSize = safeSize(rawSize);
                totalUnits += itemSize;

                OutputTarget outputTarget = resolveOutputFile(request.targetDir, entryName, request.conflictMode, reserved);
                targetPlan.add(outputTarget.reportedFile, false);
                File output = outputTarget.file;
                fileIndices.add(i);
                outputFiles.add(output);
                reportedFiles.add(outputTarget.reportedFile);
                fileSizes.add(itemSize);
                entryNames.add(entryName);
                dispositions.add(outputTarget.disposition);
            }

            for (int i = 0; i < outputFiles.size(); i++) {
                if (outputFiles.get(i) == null) {
                    emitOutput(request.archiveFile, entryNames.get(i), reportedFiles.get(i), "complete", dispositions.get(i));
                }
            }

            for (File directory : outputDirectories) {
                ensureDirectory(directory);
                rejectLinkedPath(request.targetDir, directory);
            }

            if (fileIndices.isEmpty()) {

                ProgressTracker progress = new ProgressTracker(1);
                progress.emitStart();
                progress.emitDone();
                return;
            }

            ProgressTracker progress = new ProgressTracker(totalUnits);
            progress.emitStart();

            int[] indices = new int[fileIndices.size()];
            for (int i = 0; i < fileIndices.size(); i++) {
                indices[i] = fileIndices.get(i);
            }

            Map<Integer, Integer> indexToPos = new HashMap<Integer, Integer>();
            for (int i = 0; i < fileIndices.size(); i++) {
                indexToPos.put(fileIndices.get(i), i);
            }

            final boolean encryptedFinal = encrypted;
            final String effectivePassword = password == null ? "" : password;
            final File[] currentOutput = new File[1];
            final FileOutputStream[] currentStream = new FileOutputStream[1];
            final boolean[] currentSuccess = new boolean[1];
            final long[] currentRemaining = new long[1];
            final Throwable[] firstError = new Throwable[1];
            final int[] currentPos = new int[] { -1 };
            final boolean[] passwordRequested = new boolean[1];
            final boolean[] outputProduced = new boolean[1];

            BulkExtractCallback extractCallback = new BulkExtractCallback(
                    archive, request.archiveFile, request.targetDir, indexToPos, fileIndices, outputFiles, fileSizes, entryNames, dispositions,
                    progress, encryptedFinal, effectivePassword, currentOutput,
                    currentStream, currentSuccess, currentRemaining, currentPos, firstError, passwordRequested, outputProduced
                );
            try {
                archive.extract(indices, false, extractCallback);
            } catch (SevenZipException error) {
                if (!outputProduced[0] && looksLikeWrongPassword(error, encryptedFinal || passwordRequested[0])) {
                    throw new WrongPasswordException(error);
                }
                throw error;
            } finally {
                extractCallback.finishCurrentOutput();
            }

            if (firstError[0] != null) {
                if (firstError[0] instanceof WrongPasswordException) {
                    throw (WrongPasswordException) firstError[0];
                }
                throw (Exception) firstError[0];
            }

            progress.emitDone();
        } finally {
            if (context != null) {
                context.close();
            }
        }
    }

    private static SevenZipArchiveContext openSevenZipArchive(File archiveFile, String password) throws Exception {
        String nameLower = archiveFile.getName().toLowerCase(Locale.ROOT);
        String effectivePassword = password == null ? "" : password;
        SevenZipVolumeCallback callback = new SevenZipVolumeCallback(archiveFile, effectivePassword);

        if (SEVEN_ZIP_SPLIT_RE.matcher(nameLower).matches()) {
            VolumedArchiveInStream volumed = new VolumedArchiveInStream(archiveFile.getName(), callback);
            try {
                IInArchive archive = SevenZip.openInArchive(null, volumed, callback);
                return new SevenZipArchiveContext(archive, null, volumed, callback);
            } catch (Exception error) {
                SevenZipException volumeAccessError = callback.getVolumeAccessError();
                callback.close();
                if (volumeAccessError != null) {
                    throw volumeAccessError;
                }
                if (callback.wasPasswordRequested()) {
                    throw new WrongPasswordException(error);
                }
                throw error;
            }
        }

        RandomAccessFile raf = new RandomAccessFile(archiveFile, "r");
        RandomAccessFileInStream stream = new RandomAccessFileInStream(raf);
        try {
            IInArchive archive = SevenZip.openInArchive(null, stream, callback);
            return new SevenZipArchiveContext(archive, stream, null, callback);
        } catch (Exception error) {
            SevenZipException volumeAccessError = callback.getVolumeAccessError();
            try {
                stream.close();
            } catch (Throwable ignored) {
            }
            try {
                raf.close();
            } catch (Throwable ignored) {
            }
            callback.close();
            if (volumeAccessError != null) {
                throw volumeAccessError;
            }
            if (callback.wasPasswordRequested()) {
                throw new WrongPasswordException(error);
            }
            throw error;
        }
    }

    private static boolean isWrongPassword(ZipException error, boolean encrypted, boolean outputProduced) {
        if (error == null) {
            return false;
        }
        if (outputProduced) {
            return false;
        }
        if (error.getType() == ZipException.Type.WRONG_PASSWORD) {
            return true;
        }
        String text = safeMessage(error).toLowerCase(Locale.ROOT);
        if (text.contains("wrong password") || text.contains("falsches passwort")) {
            return true;
        }
        return encrypted && text.contains("password");
    }

    private static boolean isZipIntegrityFailure(Throwable error, boolean encrypted, boolean outputProduced) {
        if (!encrypted || error == null) {
            return false;
        }
        String text = safeMessage(error).toLowerCase(Locale.ROOT);
        return outputProduced || text.contains("aes verification failed") || text.contains("checksum") || text.contains("crc");
    }

    private static Exception zipIntegrityFailure(FileHeader header, Throwable error) {
        if (header != null && header.getEncryptionMethod() == EncryptionMethod.ZIP_STANDARD) {
            return new AmbiguousPasswordOrIntegrityException(error);
        }
        return new IOException("zip4j-Fehler: CRCERROR", error);
    }

    private static boolean isPasswordFailure(ExtractOperationResult result, boolean encrypted, boolean outputProduced) {
        if (result == ExtractOperationResult.WRONG_PASSWORD) {
            return true;
        }
        if (!encrypted || outputProduced || result == null) {
            return false;
        }
        return result == ExtractOperationResult.CRCERROR || result == ExtractOperationResult.DATAERROR;
    }

    private static boolean looksLikeWrongPassword(Throwable error, boolean encrypted) {
        if (error == null) {
            return false;
        }
        String text = safeMessage(error).toLowerCase(Locale.ROOT);
        if (text.contains("wrong password") || text.contains("falsches passwort")) {
            return true;
        }
        return encrypted && (text.contains("crc") || text.contains("data error") || text.contains("checksum"));
    }

    private static boolean shouldUseZip4j(File archiveFile) {
        String name = archiveFile.getName().toLowerCase(Locale.ROOT);
        if (NUMBERED_ZIP_SPLIT_RE.matcher(name).matches()) {
            return true;
        }
        if (OLD_ZIP_SPLIT_RE.matcher(name).matches()) {
            return true;
        }
        if (name.endsWith(".zip")) {
            File parent = archiveFile.getParentFile();
            if (parent == null || !parent.exists()) {
                return false;
            }
            String stem = archiveFile.getName().substring(0, archiveFile.getName().length() - 4);
            File[] siblings = parent.listFiles();
            if (siblings == null) {
                return false;
            }
            String prefix = (stem + ".z").toLowerCase(Locale.ROOT);
            for (File sibling : siblings) {
                String siblingName = sibling.getName().toLowerCase(Locale.ROOT);
                if (!sibling.isFile()) {
                    continue;
                }
                if (siblingName.startsWith(prefix) && siblingName.length() >= prefix.length() + 2) {
                    String suffix = siblingName.substring(prefix.length());
                    if (DIGIT_SUFFIX_RE.matcher(suffix).matches()) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private static File resolveDirectory(File targetDir, String entryName) throws IOException {
        File directory = secureResolve(targetDir, entryName);
        rejectLinkedPath(targetDir, directory);
        return directory;
    }

    private static OutputTarget resolveOutputFile(File targetDir, String entryName, ConflictMode conflictMode, Set<String> reserved) throws IOException {
        File base = secureResolve(targetDir, entryName);
        rejectLinkedPath(targetDir, base);
        String key = pathKey(base);
        boolean exists = base.exists() || reserved.contains(key);

        if (!exists) {
            reserved.add(key);
            return new OutputTarget(base, base, "written");
        }

        if (conflictMode == ConflictMode.SKIP) {
            return new OutputTarget(null, base, "skipped");
        }

        if (conflictMode == ConflictMode.OVERWRITE) {
            if (base.exists()) {
                if (!base.isFile()) {
                    throw new IOException("Konnte Datei nicht uberschreiben: " + base.getAbsolutePath());
                }
            }
            reserved.add(key);
            return new OutputTarget(base, base, "overwritten");
        }

        File parent = base.getParentFile();
        String fileName = base.getName();
        int dot = fileName.lastIndexOf('.');
        String stem = dot > 0 ? fileName.substring(0, dot) : fileName;
        String ext = dot > 0 ? fileName.substring(dot) : "";

        int counter = 1;
        while (counter <= 10000) {
            String candidateName = stem + " (" + counter + ")" + ext;
            File candidate = new File(parent, candidateName);
            rejectLinkedPath(targetDir, candidate);
            String candidateKey = pathKey(candidate);
            if (!candidate.exists() && !reserved.contains(candidateKey)) {
                reserved.add(candidateKey);
                return new OutputTarget(candidate, candidate, "renamed");
            }
            counter += 1;
        }

        throw new IOException("Rename-Limit erreicht fur " + entryName);
    }

    private static File secureResolve(File targetDir, String entryName) throws IOException {
        String normalized = normalizeEntryName(entryName, "file");
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.startsWith("\\")) {
            normalized = normalized.substring(1);
        }
        if (normalized.matches("^[a-zA-Z]:.*")) {
            normalized = normalized.substring(2);
            while (normalized.startsWith("/")) {
                normalized = normalized.substring(1);
            }
            while (normalized.startsWith("\\")) {
                normalized = normalized.substring(1);
            }
        }
        File targetCanonical = targetDir.getCanonicalFile();
        Path targetPathValue = targetCanonical.toPath().toAbsolutePath().normalize();
        Path outputPathValue = targetPathValue.resolve(normalized).normalize();
        String targetPath = targetPathValue.toString();
        String outputPath = outputPathValue.toString();
        String targetPathNorm = isWindows() ? targetPath.toLowerCase(Locale.ROOT) : targetPath;
        String outputPathNorm = isWindows() ? outputPath.toLowerCase(Locale.ROOT) : outputPath;
        String targetPrefix = targetPathNorm.endsWith(File.separator) ? targetPathNorm : targetPathNorm + File.separator;
        if (!outputPathNorm.equals(targetPathNorm) && !outputPathNorm.startsWith(targetPrefix)) {
            throw new IOException("Path Traversal blockiert: " + entryName);
        }
        File output = outputPathValue.toFile();
        rejectLinkedPath(targetCanonical, output);
        return output;
    }

    private static String normalizeEntryName(String value, String fallback) {
        String entry = value == null ? "" : value;
        if (entry.trim().length() == 0) {
            return fallback;
        }
        entry = entry.replace('\\', '/');
        while (entry.startsWith("./")) {
            entry = entry.substring(2);
        }
        if (entry.length() == 0) {
            return fallback;
        }

        while (entry.endsWith("/")) {
            entry = entry.substring(0, entry.length() - 1);
        }
        validateWindowsEntryName(entry);

        String[] segments = entry.split("/", -1);
        StringBuilder sanitized = new StringBuilder();
        for (int i = 0; i < segments.length; i++) {
            if (i > 0) {
                sanitized.append('/');
            }
            sanitized.append(WINDOWS_SPECIAL_CHARS_RE.matcher(segments[i]).replaceAll("_"));
        }
        entry = sanitized.toString();
        if (entry.length() == 0) {
            return fallback;
        }
        return entry;
    }

    private static void validateWindowsEntryName(String entry) {
        if (entry.startsWith("/") || entry.matches("^[a-zA-Z]:.*")) {
            throw new IllegalArgumentException("Ungueltiger Windows-Archivpfad: " + entry);
        }
        String[] segments = entry.split("/", -1);
        for (String segment : segments) {
            if (segment.length() == 0 || ".".equals(segment) || "..".equals(segment)
                    || segment.endsWith(".") || segment.endsWith(" ")
                    || WINDOWS_SPECIAL_CHARS_RE.matcher(segment).find()) {
                throw new IllegalArgumentException("Ungueltiger Windows-Archivpfad: " + entry);
            }
            for (int i = 0; i < segment.length(); i++) {
                if (segment.charAt(i) < 32) {
                    throw new IllegalArgumentException("Ungueltiger Windows-Archivpfad: " + entry);
                }
            }
            int dot = segment.indexOf('.');
            String base = (dot >= 0 ? segment.substring(0, dot) : segment).toUpperCase(Locale.ROOT);
            if ("CON".equals(base) || "PRN".equals(base) || "AUX".equals(base) || "NUL".equals(base)
                    || base.matches("COM[1-9¹²³]") || base.matches("LPT[1-9¹²³]")) {
                throw new IllegalArgumentException("Reservierter Windows-Archivpfad: " + entry);
            }
        }
    }

    private static long safeSize(Long value) {
        if (value == null) {
            return 0;
        }
        long size = value.longValue();
        if (size <= 0) {
            return 0;
        }
        return size;
    }

    private static void rejectLinkedPath(File targetDir, File file) throws IOException {
        if (targetDir == null || file == null) {
            return;
        }
        Path root = targetDir.getCanonicalFile().toPath().toAbsolutePath().normalize();
        Path current = file.toPath().toAbsolutePath().normalize();
        String rootValue = isWindows() ? root.toString().toLowerCase(Locale.ROOT) : root.toString();
        while (current != null) {
            String currentValue = isWindows() ? current.toString().toLowerCase(Locale.ROOT) : current.toString();
            String prefix = rootValue.endsWith(File.separator) ? rootValue : rootValue + File.separator;
            if (!currentValue.equals(rootValue) && !currentValue.startsWith(prefix)) {
                throw new IOException("Path Traversal blockiert: " + file.getAbsolutePath());
            }
            if (Files.exists(current, LinkOption.NOFOLLOW_LINKS)) {
                BasicFileAttributes attributes = Files.readAttributes(current, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                if (attributes.isSymbolicLink() || attributes.isOther()) {
                    throw new IOException("Symlink oder Reparse Point blockiert: " + current.toString());
                }
            }
            if (currentValue.equals(rootValue)) {
                break;
            }
            current = current.getParent();
        }
    }

    private static void ensureDirectory(File dir) throws IOException {
        if (dir == null) {
            return;
        }
        if (dir.exists()) {
            if (!dir.isDirectory()) {
                throw new IOException("Pfad ist keine Directory: " + dir.getAbsolutePath());
            }
            return;
        }
        if (!dir.mkdirs() && !dir.isDirectory()) {
            throw new IOException("Verzeichnis konnte nicht erstellt werden: " + dir.getAbsolutePath());
        }
    }

    private static String pathKey(File file) {
        String value = file.toPath().toAbsolutePath().normalize().toString();
        if (isWindows()) {
            value = value.toLowerCase(Locale.ROOT);
        }
        return value;
    }

    private static final class RawArchivePlanInvariant {
        private final RawArchivePlanNode root = new RawArchivePlanNode("");

        void add(String relativeTarget, boolean directory) throws IOException {
            String normalizedSpelling = relativeTarget == null ? "" : relativeTarget.replace('\\', '/');
            while (normalizedSpelling.endsWith("/")) {
                normalizedSpelling = normalizedSpelling.substring(0, normalizedSpelling.length() - 1);
            }
            if (normalizedSpelling.length() == 0) {
                throw new IOException("Raw-Archivplan-Kollision: leeres Ziel");
            }
            String[] segments = normalizedSpelling.split("/", -1);
            StringBuilder canonicalKey = new StringBuilder();
            RawArchivePlanNode node = root;
            for (String segment : segments) {
                if (node.entry != null && !node.entry.directory) {
                    throw new IOException("Raw-Archivplan-Kollision: Datei ist Vorfahr von " + normalizedSpelling);
                }
                String canonicalSegment = segment.toLowerCase(Locale.ROOT);
                if (canonicalKey.length() > 0) {
                    canonicalKey.append('/');
                }
                canonicalKey.append(canonicalSegment);
                RawArchivePlanNode child = node.children.get(canonicalSegment);
                if (child == null) {
                    child = new RawArchivePlanNode(segment);
                    node.children.put(canonicalSegment, child);
                } else if (!child.segmentSpelling.equals(segment)) {
                    throw new IOException("Raw-Archivplan-Kollision: Windows-Case-Alias " + normalizedSpelling);
                }
                node = child;
            }
            if (node.entry != null) {
                if (node.entry.directory && directory && node.entry.normalizedSpelling.equals(normalizedSpelling)) {
                    return;
                }
                throw new IOException("Raw-Archivplan-Kollision: mehrfaches oder typwidriges Ziel " + node.entry.canonicalWindowsKey);
            }
            if (!directory && !node.children.isEmpty()) {
                throw new IOException("Raw-Archivplan-Kollision: Datei ist Vorfahr eines anderen Ziels " + normalizedSpelling);
            }
            node.entry = new RawArchivePlanEntry(canonicalKey.toString(), normalizedSpelling, directory);
        }
    }

    private static final class RawArchivePlanNode {
        private final String segmentSpelling;
        private final Map<String, RawArchivePlanNode> children = new HashMap<String, RawArchivePlanNode>();
        private RawArchivePlanEntry entry;

        private RawArchivePlanNode(String segmentSpelling) {
            this.segmentSpelling = segmentSpelling;
        }
    }

    private static final class RawArchivePlanEntry {
        private final String canonicalWindowsKey;
        private final String normalizedSpelling;
        private final boolean directory;

        private RawArchivePlanEntry(String canonicalWindowsKey, String normalizedSpelling, boolean directory) {
            this.canonicalWindowsKey = canonicalWindowsKey;
            this.normalizedSpelling = normalizedSpelling;
            this.directory = directory;
        }
    }

    private static final class TargetPlanInvariant {
        private final TargetPlanNode root = new TargetPlanNode();

        void add(File file, boolean directory) throws IOException {
            String key = pathKey(file).replace('\\', '/');
            String[] segments = key.split("/");
            TargetPlanNode node = root;
            for (String segment : segments) {
                if (segment.length() == 0) {
                    continue;
                }
                if (node.file) {
                    throw new IOException("Target-Plan-Kollision: Datei ist Vorfahr von " + file.getAbsolutePath());
                }
                TargetPlanNode child = node.children.get(segment);
                if (child == null) {
                    child = new TargetPlanNode();
                    node.children.put(segment, child);
                }
                node = child;
            }
            if (node.file || node.directory) {
                if (directory && node.directory && !node.file) {
                    return;
                }
                throw new IOException("Target-Plan-Kollision: mehrfaches oder typwidriges Ziel " + file.getAbsolutePath());
            }
            if (!directory && !node.children.isEmpty()) {
                throw new IOException("Target-Plan-Kollision: Datei ist Vorfahr eines anderen Ziels " + file.getAbsolutePath());
            }
            node.directory = directory;
            node.file = !directory;
        }
    }

    private static final class TargetPlanNode {
        private final Map<String, TargetPlanNode> children = new HashMap<String, TargetPlanNode>();
        private boolean file;
        private boolean directory;
    }

    private static boolean isWindows() {
        String osName = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        return osName.contains("win");
    }

    private static List<String> normalizePasswords(List<String> input) {
        LinkedHashSet<String> deduped = new LinkedHashSet<String>();
        deduped.add("");
        if (input != null) {
            for (String value : input) {
                deduped.add(value == null ? "" : value);
            }
        }
        return new ArrayList<String>(deduped);
    }

    private static ExtractionRequest parseArgs(String[] args) {
        ExtractionRequest request = new ExtractionRequest();
        int index = 0;
        while (index < args.length) {
            String key = args[index];
            if ("--archive".equals(key)) {
                request.archiveFile = new File(readNext(args, ++index, key));
            } else if ("--target".equals(key)) {
                request.targetDir = new File(readNext(args, ++index, key));
            } else if ("--conflict".equals(key)) {
                request.conflictMode = ConflictMode.fromValue(readNext(args, ++index, key));
            } else if ("--backend".equals(key)) {
                request.backend = Backend.fromValue(readNext(args, ++index, key));
            } else if ("--password".equals(key)) {
                request.passwords.add(readNext(args, ++index, key));
            } else {
                throw new IllegalArgumentException("Unbekanntes Argument: " + key);
            }
            index += 1;
        }

        if (request.archiveFile == null) {
            throw new IllegalArgumentException("--archive fehlt");
        }
        if (request.targetDir == null) {
            throw new IllegalArgumentException("--target fehlt");
        }
        if (!request.archiveFile.exists() || !request.archiveFile.isFile()) {
            throw new IllegalArgumentException("Archiv nicht gefunden: " + request.archiveFile.getAbsolutePath());
        }
        return request;
    }

    private static String readNext(String[] args, int index, String key) {
        if (index >= args.length) {
            throw new IllegalArgumentException("Wert fehlt fur " + key);
        }
        return args[index];
    }

    private static String safeMessage(Throwable error) {
        if (error == null) {
            return "Unbekannter Fehler";
        }
        String message = error.getMessage();
        if (message == null || message.trim().length() == 0) {
            message = error.toString();
        }
        return message.replace('\n', ' ').replace('\r', ' ').trim();
    }

    private static void emitBackend(Backend backend) {
        System.out.println("RD_BACKEND " + backend.value);
    }

    private static void emitPasswordAttempt(int attempt, int total) {
        System.out.println("RD_PASSWORD_ATTEMPT " + attempt + " " + total);
    }

    private static void emitDone() {
        System.out.println("RD_DONE");
    }

    private static void emitError(String message) {
        System.err.println("RD_ERROR " + message);
    }

    private static String encodeField(String value) {
        return Base64.getEncoder().encodeToString((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
    }

    private static void emitOutput(File archiveFile, String entryPath, File outputFile, String state, String disposition) {
        if (archiveFile == null || outputFile == null) {
            return;
        }
        System.out.println("RD_OUTPUT 1 " + state + " " + disposition + " "
                + encodeField(archiveFile.getAbsolutePath()) + " "
                + encodeField(entryPath == null ? "" : entryPath.replace('\\', '/')) + " "
                + encodeField(outputFile.getAbsolutePath()));
    }

    private enum Backend {
        AUTO("auto"),
        SEVENZIPJBIND("7zjbinding"),
        ZIP4J("zip4j");

        private final String value;

        Backend(String value) {
            this.value = value;
        }

        static Backend fromValue(String raw) {
            String value = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
            if ("auto".equals(value)) {
                return AUTO;
            }
            if ("7zjb".equals(value) || "7zjbinding".equals(value) || "sevenzipjbinding".equals(value)) {
                return SEVENZIPJBIND;
            }
            if ("zip4j".equals(value)) {
                return ZIP4J;
            }
            throw new IllegalArgumentException("Ungueltiger Backend-Wert: " + raw);
        }
    }

    private enum ConflictMode {
        OVERWRITE,
        SKIP,
        RENAME;

        static ConflictMode fromValue(String raw) {
            String value = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
            if ("overwrite".equals(value)) {
                return OVERWRITE;
            }
            if ("skip".equals(value) || "ask".equals(value)) {
                return SKIP;
            }
            if ("rename".equals(value)) {
                return RENAME;
            }
            throw new IllegalArgumentException("Ungueltiger Conflict-Wert: " + raw);
        }
    }

    private static final class ExtractionRequest {
        private File archiveFile;
        private File targetDir;
        private ConflictMode conflictMode = ConflictMode.SKIP;
        private Backend backend = Backend.AUTO;
        private final List<String> passwords = new ArrayList<String>();
    }

    private static final class OutputTarget {
        private final File file;
        private final File reportedFile;
        private final String disposition;

        OutputTarget(File file, File reportedFile, String disposition) {
            this.file = file;
            this.reportedFile = reportedFile;
            this.disposition = disposition;
        }
    }

    private static final class BulkExtractCallback implements IArchiveExtractCallback, ICryptoGetTextPassword {
        private final IInArchive archive;
        private final File archiveFile;
        private final File targetDir;
        private final Map<Integer, Integer> indexToPos;
        private final List<Integer> fileIndices;
        private final List<File> outputFiles;
        private final List<Long> fileSizes;
        private final List<String> entryNames;
        private final List<String> dispositions;
        private final ProgressTracker progress;
        private final boolean encrypted;
        private final String password;
        private final File[] currentOutput;
        private final FileOutputStream[] currentStream;
        private final boolean[] currentSuccess;
        private final long[] currentRemaining;
        private final int[] currentPos;
        private final Throwable[] firstError;
        private final boolean[] passwordRequested;
        private final boolean[] outputProduced;

        BulkExtractCallback(IInArchive archive, File archiveFile, File targetDir, Map<Integer, Integer> indexToPos,
                List<Integer> fileIndices, List<File> outputFiles, List<Long> fileSizes,
                List<String> entryNames, List<String> dispositions,
                ProgressTracker progress, boolean encrypted, String password,
                File[] currentOutput, FileOutputStream[] currentStream,
                boolean[] currentSuccess, long[] currentRemaining, int[] currentPos,
                Throwable[] firstError, boolean[] passwordRequested, boolean[] outputProduced) {
            this.archive = archive;
            this.archiveFile = archiveFile;
            this.targetDir = targetDir;
            this.indexToPos = indexToPos;
            this.fileIndices = fileIndices;
            this.outputFiles = outputFiles;
            this.fileSizes = fileSizes;
            this.entryNames = entryNames;
            this.dispositions = dispositions;
            this.progress = progress;
            this.encrypted = encrypted;
            this.password = password;
            this.currentOutput = currentOutput;
            this.currentStream = currentStream;
            this.currentSuccess = currentSuccess;
            this.currentRemaining = currentRemaining;
            this.currentPos = currentPos;
            this.firstError = firstError;
            this.passwordRequested = passwordRequested;
            this.outputProduced = outputProduced;
        }

        @Override
        public String cryptoGetTextPassword() {
            passwordRequested[0] = true;
            return password;
        }

        @Override
        public void setTotal(long total) {

        }

        @Override
        public void setCompleted(long complete) {

        }

        @Override
        public ISequentialOutStream getStream(int index, ExtractAskMode extractAskMode) throws SevenZipException {
            discardCurrentOutput();

            Integer pos = indexToPos.get(index);
            if (pos == null) {
                return null;
            }
            currentPos[0] = pos;
            currentOutput[0] = outputFiles.get(pos);
            currentSuccess[0] = false;
            currentRemaining[0] = fileSizes.get(pos);

            if (extractAskMode != ExtractAskMode.EXTRACT) {
                currentOutput[0] = null;
                return null;
            }

            if (currentOutput[0] == null) {
                progress.advance(currentRemaining[0]);
                return null;
            }

            try {
                rejectLinkedPath(targetDir, currentOutput[0]);
                emitOutput(archiveFile, entryNames.get(currentPos[0]), currentOutput[0], "opened", dispositions.get(currentPos[0]));
                ensureDirectory(currentOutput[0].getParentFile());
                rejectLinkedPath(targetDir, currentOutput[0]);
                currentStream[0] = new FileOutputStream(currentOutput[0]);
            } catch (IOException error) {
                throw new SevenZipException("Fehler beim Erstellen: " + error.getMessage(), error);
            }

            return new ISequentialOutStream() {
                @Override
                public int write(byte[] data) throws SevenZipException {
                    if (data == null || data.length == 0) {
                        return 0;
                    }
                    try {
                        currentStream[0].write(data);
                        outputProduced[0] = true;
                    } catch (IOException error) {
                        throw new SevenZipException("Fehler beim Schreiben: " + error.getMessage(), error);
                    }
                    long accounted = Math.min(currentRemaining[0], (long) data.length);
                    currentRemaining[0] -= accounted;
                    progress.advance(accounted);
                    return data.length;
                }
            };
        }

        @Override
        public void prepareOperation(ExtractAskMode extractAskMode) {

        }

        @Override
        public void setOperationResult(ExtractOperationResult result) throws SevenZipException {
            if (currentRemaining[0] > 0) {
                progress.advance(currentRemaining[0]);
                currentRemaining[0] = 0;
            }

            if (result == ExtractOperationResult.OK) {
                currentSuccess[0] = true;
                closeCurrentStreamOnly();
                if (currentPos[0] >= 0 && currentOutput[0] != null) {
                    try {
                        int archiveIndex = fileIndices.get(currentPos[0]);
                        java.util.Date modified = (java.util.Date) archive.getProperty(archiveIndex, PropID.LAST_MODIFICATION_TIME);
                        if (modified != null) {
                            currentOutput[0].setLastModified(modified.getTime());
                        }
                    } catch (Throwable ignored) {

                    }
                    emitOutput(archiveFile, entryNames.get(currentPos[0]), currentOutput[0], "complete", dispositions.get(currentPos[0]));
                }
            } else {
                discardCurrentOutput();
                if (firstError[0] == null) {
                    if (isPasswordFailure(result, encrypted || passwordRequested[0], outputProduced[0])) {
                        firstError[0] = new WrongPasswordException(new IOException("Falsches Passwort"));
                    } else {
                        firstError[0] = new IOException("7z-Fehler: " + result.name());
                    }
                }
            }
        }

        void finishCurrentOutput() {
            discardCurrentOutput();
        }

        private void closeCurrentStreamOnly() {
            if (currentStream[0] != null) {
                try {
                    currentStream[0].close();
                } catch (Throwable ignored) {
                }
                currentStream[0] = null;
            }
        }

        private void discardCurrentOutput() {
            closeCurrentStreamOnly();
            if (!currentSuccess[0] && currentOutput[0] != null && currentOutput[0].exists()) {
                int pos = currentPos[0];
                if (currentOutput[0].delete()) {
                    if (pos >= 0) {
                        emitOutput(archiveFile, entryNames.get(pos), currentOutput[0], "removed", dispositions.get(pos));
                    }
                } else if (pos >= 0) {
                    emitOutput(archiveFile, entryNames.get(pos), currentOutput[0], "partial", dispositions.get(pos));
                }
            }
            currentOutput[0] = null;
            currentPos[0] = -1;
            currentSuccess[0] = false;
            currentRemaining[0] = 0;
        }
    }

    private static final class WrongPasswordException extends Exception {
        private static final long serialVersionUID = 1L;

        WrongPasswordException(Throwable cause) {
            super(cause);
        }
    }

    private static final class AmbiguousPasswordOrIntegrityException extends Exception {
        private static final long serialVersionUID = 1L;

        AmbiguousPasswordOrIntegrityException(Throwable cause) {
            super("zip4j-Fehler: CRCERROR", cause);
        }
    }

    private static final class ProgressTracker {
        private final long total;
        private long completed;
        private int lastPercent = -1;

        ProgressTracker(long totalUnits) {
            this.total = Math.max(1L, totalUnits);
            this.completed = 0L;
        }

        synchronized void emitStart() {
            emitPercent(0);
        }

        synchronized void advance(long units) {
            if (units <= 0) {
                return;
            }
            completed += units;
            if (completed > total) {
                completed = total;
            }
            int percent = (int) Math.min(100L, Math.max(0L, (completed * 100L) / total));
            emitPercent(percent);
        }

        synchronized void emitDone() {
            completed = total;
            emitPercent(100);
        }

        private void emitPercent(int percent) {
            int bounded = Math.max(0, Math.min(100, percent));
            if (bounded == lastPercent) {
                return;
            }
            lastPercent = bounded;
            System.out.println("RD_PROGRESS " + bounded + "%");
        }
    }

    private static final class SevenZipArchiveContext implements Closeable {
        private final IInArchive archive;
        private final IInStream rootStream;
        private final VolumedArchiveInStream volumedArchiveInStream;
        private final SevenZipVolumeCallback callback;

        SevenZipArchiveContext(IInArchive archive, IInStream rootStream, VolumedArchiveInStream volumedArchiveInStream, SevenZipVolumeCallback callback) {
            this.archive = archive;
            this.rootStream = rootStream;
            this.volumedArchiveInStream = volumedArchiveInStream;
            this.callback = callback;
        }

        @Override
        public void close() {
            if (archive != null) {
                try {
                    archive.close();
                } catch (Throwable ignored) {
                }
            }
            if (rootStream != null) {
                try {
                    rootStream.close();
                } catch (Throwable ignored) {
                }
            }
            if (volumedArchiveInStream != null) {
                try {
                    volumedArchiveInStream.close();
                } catch (Throwable ignored) {
                }
            }
            if (callback != null) {
                callback.close();
            }
        }
    }

    private static final class SevenZipVolumeCallback implements IArchiveOpenCallback, IArchiveOpenVolumeCallback, ICryptoGetTextPassword, Closeable {
        private final File archiveDir;
        private final String firstFileName;
        private final String password;
        private boolean passwordRequested;
        private SevenZipException volumeAccessError;
        private final Map<String, RandomAccessFile> openRafs = new HashMap<String, RandomAccessFile>();

        SevenZipVolumeCallback(File archiveFile, String password) {
            this.archiveDir = archiveFile.getAbsoluteFile().getParentFile();
            this.firstFileName = archiveFile.getName();
            this.password = password == null ? "" : password;
        }

        @Override
        public Object getProperty(PropID propID) {
            if (propID == PropID.NAME) {
                return firstFileName;
            }
            return null;
        }

        @Override
        public IInStream getStream(String filename) throws SevenZipException {
            File file = resolveVolumeFile(filename);
            if (file == null || !file.exists() || !file.isFile()) {
                return null;
            }
            try {
                String key = pathKey(file);
                RandomAccessFile raf = openRafs.get(key);
                if (raf == null) {
                    raf = new RandomAccessFile(file, "r");
                    openRafs.put(key, raf);
                }
                raf.seek(0L);
                return new RandomAccessFileInStream(raf);
            } catch (IOException error) {
                volumeAccessError = new SevenZipException("Volume konnte nicht geoffnet werden: " + filename, error);
                throw volumeAccessError;
            }
        }

        @Override
        public void setTotal(Long files, Long bytes) {

        }

        @Override
        public void setCompleted(Long files, Long bytes) {

        }

        @Override
        public String cryptoGetTextPassword() {
            passwordRequested = true;
            return password;
        }

        boolean wasPasswordRequested() {
            return passwordRequested;
        }

        SevenZipException getVolumeAccessError() {
            return volumeAccessError;
        }

        private File resolveVolumeFile(String filename) {
            if (filename == null || filename.trim().length() == 0) {
                return null;
            }

            String baseName = new File(filename).getName();
            if (archiveDir != null) {
                File relative = new File(archiveDir, baseName);
                if (relative.exists()) {
                    return relative;
                }
                File[] siblings = archiveDir.listFiles();
                if (siblings != null) {
                    for (File sibling : siblings) {
                        if (!sibling.isFile()) {
                            continue;
                        }
                        if (sibling.getName().equalsIgnoreCase(baseName)) {
                            return sibling;
                        }
                    }
                }
            }
            return null;
        }

        @Override
        public void close() {
            for (RandomAccessFile raf : openRafs.values()) {
                try {
                    raf.close();
                } catch (Throwable ignored) {
                }
            }
            openRafs.clear();
        }
    }
}
