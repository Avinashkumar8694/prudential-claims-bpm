package bpmscript;

import java.util.Objects;

/**
 * jBPM / Drools KieFunctions shim for condition expressions:
 * KieFunctions.equalsTo, KieFunctions.isTrue, KieFunctions.isFalse, etc.
 */
public final class KieFunctions {
    private KieFunctions() {}

    public static boolean equalsTo(Object a, Object b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        if (a.equals(b)) return true;
        return Objects.equals(String.valueOf(a), String.valueOf(b));
    }

    public static boolean isTrue(Object a) {
        if (a == null) return false;
        if (a instanceof Boolean) return (Boolean) a;
        String s = String.valueOf(a).trim().toLowerCase();
        return "true".equals(s) || "1".equals(s);
    }

    public static boolean isFalse(Object a) {
        return !isTrue(a);
    }

    public static boolean isNull(Object a) {
        return a == null;
    }

    public static boolean notNull(Object a) {
        return a != null;
    }

    public static boolean isEmpty(Object a) {
        return a == null || String.valueOf(a).trim().isEmpty();
    }

    public static boolean greaterThan(Number a, Number b) {
        if (a == null || b == null) return false;
        return a.doubleValue() > b.doubleValue();
    }

    public static boolean lessThan(Number a, Number b) {
        if (a == null || b == null) return false;
        return a.doubleValue() < b.doubleValue();
    }

    public static boolean greaterOrEqual(Number a, Number b) {
        if (a == null || b == null) return false;
        return a.doubleValue() >= b.doubleValue();
    }

    public static boolean lessOrEqual(Number a, Number b) {
        if (a == null || b == null) return false;
        return a.doubleValue() <= b.doubleValue();
    }
}
