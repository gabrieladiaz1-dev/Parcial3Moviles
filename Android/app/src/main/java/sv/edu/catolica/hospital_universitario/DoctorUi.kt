package sv.edu.catolica.hospital_universitario

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * Kit visual del módulo Doctor: espejo de HospitalTheme, HospitalCard, ConsultationCardStyle,
 * ConsultationBlockHeader y demás componentes SwiftUI de iOS. Medidas en dp/sp equivalentes a puntos iOS.
 */
object DoctorTheme {
    val wine = Color.rgb(119, 7, 39)
    val wineDark = Color.rgb(77, 4, 26)
    val background = Color.rgb(248, 248, 250)
    val ink = Color.rgb(36, 41, 54)
    val secondary = Color.rgb(117, 126, 145)
    val rose = Color.rgb(251, 234, 240)
    val green = Color.rgb(227, 246, 234)
    val greenInk = Color.rgb(33, 128, 77)
    val warnFill = Color.rgb(255, 242, 217)
    val warnInk = Color.rgb(153, 102, 0)
    val blueFill = Color.rgb(231, 241, 253)
    val errorInk = Color.rgb(161, 18, 46)
    val errorFill = Color.rgb(252, 237, 237)
    val successInk = Color.rgb(31, 107, 61)
    val successFill = Color.rgb(232, 245, 237)
    val divider = Color.rgb(226, 226, 230)
    val segmentTrack = Color.rgb(238, 238, 240)
    const val CLEAR = Color.TRANSPARENT
    fun alpha(color: Int, fraction: Float) = Color.argb((fraction * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))
}

/** Tipografía SF → Roboto con los tamaños de los estilos dinámicos de iOS. */
data class DFont(val size: Float, val weight: Int = 0) {
    companion object {
        val LARGE = DFont(34f, 1); val TITLE = DFont(28f, 2); val TITLE2 = DFont(22f, 2); val TITLE3 = DFont(20f, 2)
        val HEADLINE = DFont(17f, 1); val BODY = DFont(17f, 0)
        val SUBHEAD = DFont(15f, 0); val SUBHEAD_SEMI = DFont(15f, 1); val SUBHEAD_BOLD = DFont(15f, 2)
        val FOOTNOTE = DFont(13f, 0); val FOOTNOTE_SEMI = DFont(13f, 1); val FOOTNOTE_BOLD = DFont(13f, 2)
        val CAPTION = DFont(12f, 0); val CAPTION_SEMI = DFont(12f, 1); val CAPTION_BOLD = DFont(12f, 2)
        val CAPTION2 = DFont(11f, 0); val CAPTION2_SEMI = DFont(11f, 1); val CAPTION2_BOLD = DFont(11f, 2); val CAPTION2_HEAVY = DFont(11f, 3)
    }
}

class DoctorUi(private val context: Context) {
    val density = context.resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()
    fun dpf(value: Float) = value * density

    private val medium: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    private val black: Typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
    fun face(weight: Int): Typeface = when (weight) { 1 -> medium; 2 -> Typeface.DEFAULT_BOLD; 3 -> black; else -> Typeface.DEFAULT }

    // ---------- Contenedores ----------
    private fun spacer(vertical: Boolean, size: Int) = GradientDrawable().apply {
        setColor(Color.TRANSPARENT); if (vertical) setSize(1, dp(size)) else setSize(dp(size), 1)
    }
    fun vbox(spacing: Int = 0, parent: ViewGroup? = null): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(-1, -2)
        if (spacing > 0) { dividerDrawable = spacer(true, spacing); showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE }
        parent?.addView(this)
    }
    fun hbox(spacing: Int = 0, parent: ViewGroup? = null, center: Boolean = true): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = if (center) Gravity.CENTER_VERTICAL else Gravity.TOP
        layoutParams = LinearLayout.LayoutParams(-1, -2)
        if (spacing > 0) { dividerDrawable = spacer(false, spacing); showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE }
        parent?.addView(this)
    }
    fun flow(spacing: Int = 8, parent: ViewGroup? = null): DoctorFlowLayout = DoctorFlowLayout(context, dp(spacing)).apply {
        layoutParams = LinearLayout.LayoutParams(-1, -2); parent?.addView(this)
    }
    fun weight(view: View, weight: Float = 1f): View { view.layoutParams = LinearLayout.LayoutParams(0, -2, weight); return view }
    fun fill(view: View): View { view.layoutParams = LinearLayout.LayoutParams(-1, -2); return view }
    fun wrap(view: View): View { view.layoutParams = LinearLayout.LayoutParams(-2, -2); return view }
    fun spacerView(parent: LinearLayout) = View(context).also { parent.addView(it, LinearLayout.LayoutParams(0, 1, 1f)) }

    // ---------- Fondos ----------
    fun rounded(color: Int, radius: Int, stroke: Int = 0, strokeWidth: Float = 1f) = GradientDrawable().apply {
        setColor(color); cornerRadius = dpf(radius.toFloat())
        if (stroke != 0) setStroke(dpf(strokeWidth).toInt().coerceAtLeast(1), stroke)
    }
    fun gradient(radius: Int) = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(DoctorTheme.wine, DoctorTheme.wineDark)).apply {
        cornerRadius = dpf(radius.toFloat())
    }
    fun oval(color: Int, stroke: Int = 0, strokeWidth: Int = 0) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL; setColor(color); if (stroke != 0) setStroke(dp(strokeWidth), stroke)
    }
    fun capsule(color: Int, stroke: Int = 0) = GradientDrawable().apply {
        setColor(color); cornerRadius = dpf(999f); if (stroke != 0) setStroke(dp(1), stroke)
    }
    fun gradientCapsule() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(DoctorTheme.wine, DoctorTheme.wineDark)).apply { cornerRadius = dpf(999f) }

    /** `.modifier(ConsultationCardStyle())`: blanco, radio 22, padding 18, sombra suave. */
    fun <T : View> blockCard(view: T, radius: Int = 22, padding: Int = 18): T {
        view.background = rounded(Color.WHITE, radius); view.setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
        view.elevation = dpf(2f); view.outlineAmbientShadowColor(); return view
    }
    private fun View.outlineAmbientShadowColor() {
        if (android.os.Build.VERSION.SDK_INT >= 28) { outlineAmbientShadowColor = DoctorTheme.alpha(DoctorTheme.ink, 0.25f); outlineSpotShadowColor = DoctorTheme.alpha(DoctorTheme.ink, 0.25f) }
    }
    fun card(parent: ViewGroup?, spacing: Int = 12, radius: Int = 22, padding: Int = 18): LinearLayout = blockCard(vbox(spacing, parent), radius, padding)
    /** HospitalCard: blanco, radio 14, padding 14, espaciado 8. */
    fun hospitalCard(parent: ViewGroup?, spacing: Int = 8): LinearLayout = vbox(spacing, parent).apply {
        background = rounded(Color.WHITE, 14); setPadding(dp(14), dp(14), dp(14), dp(14))
    }
    /** Tarjeta destacada con degradado vino (LinearGradient.vinoDestacado). */
    fun hero(parent: ViewGroup?, spacing: Int = 10, radius: Int = 24, padding: Int = 20): LinearLayout = vbox(spacing, parent).apply {
        background = gradient(radius); setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
        elevation = dpf(4f)
        if (android.os.Build.VERSION.SDK_INT >= 28) { outlineSpotShadowColor = DoctorTheme.wine; outlineAmbientShadowColor = DoctorTheme.wine }
    }

    // ---------- Texto ----------
    fun text(value: CharSequence, font: DFont = DFont.BODY, color: Int = DoctorTheme.ink, parent: ViewGroup? = null,
             tracking: Float = 0f, upper: Boolean = false, alpha: Float = 1f, center: Boolean = false, lines: Int = 0): TextView =
        TextView(context).apply {
            text = if (upper) value.toString().uppercase() else value
            setTextSize(TypedValue.COMPLEX_UNIT_SP, font.size); typeface = face(font.weight); setTextColor(color)
            includeFontPadding = false; setLineSpacing(dpf(2f), 1f)
            if (tracking != 0f) letterSpacing = tracking / font.size
            this.alpha = alpha
            if (center) gravity = Gravity.CENTER_HORIZONTAL
            if (lines > 0) { maxLines = lines; ellipsize = android.text.TextUtils.TruncateAt.END }
            layoutParams = LinearLayout.LayoutParams(if (center) -1 else -2, -2)
            parent?.addView(this)
        }
    fun icon(res: Int, color: Int, sizeDp: Int = 18, parent: ViewGroup? = null, box: Int = 0, background: android.graphics.drawable.Drawable? = null): ImageView =
        ImageView(context).apply {
            setImageResource(res); imageTintList = ColorStateList.valueOf(color)
            val s = if (box > 0) box else sizeDp
            layoutParams = LinearLayout.LayoutParams(dp(s), dp(s))
            if (box > 0) { val inset = dp((box - sizeDp) / 2); setPadding(inset, inset, inset, inset) }
            if (background != null) this.background = background
            scaleType = ImageView.ScaleType.FIT_CENTER
            parent?.addView(this)
        }
    /** Label(title, systemImage:) */
    fun label(value: CharSequence, iconRes: Int, font: DFont = DFont.SUBHEAD, color: Int = DoctorTheme.ink, parent: ViewGroup? = null,
              iconColor: Int = color, tracking: Float = 0f, upper: Boolean = false, alpha: Float = 1f): LinearLayout =
        hbox(6, parent, center = true).apply {
            layoutParams = LinearLayout.LayoutParams(-2, -2)
            icon(iconRes, iconColor, (font.size * 1.05f).toInt().coerceAtLeast(12), this)
            text(value, font, color, this, tracking, upper)
            this.alpha = alpha
        }
    fun detail(title: String, value: String, parent: ViewGroup?) = vbox(3, parent).apply {
        text(title, DFont.CAPTION_SEMI, DoctorTheme.ink, this)
        text(value, DFont.FOOTNOTE, DoctorTheme.secondary, this).setTextIsSelectable(true)
    }
    fun heading(value: String, parent: ViewGroup?) = text(value, DFont(16f), DoctorTheme.ink, parent)

    // ---------- Píldoras y chips ----------
    fun pill(value: String, iconRes: Int? = null, fg: Int = DoctorTheme.wine, bg: Int = DoctorTheme.rose, font: DFont = DFont.CAPTION2_BOLD,
             parent: ViewGroup? = null, h: Int = 8, v: Int = 4, stroke: Int = 0, gradientBg: Boolean = false): LinearLayout =
        hbox(5, parent).apply {
            layoutParams = LinearLayout.LayoutParams(-2, -2)
            background = if (gradientBg) gradientCapsule() else capsule(bg, stroke)
            setPadding(dp(h), dp(v), dp(h), dp(v))
            if (iconRes != null) icon(iconRes, fg, (font.size + 1).toInt(), this)
            text(value, font, fg, this, lines = 2)
        }
    /** choiceChip de iOS: capsula rosa o degradado si está seleccionada. */
    fun choiceChip(title: String, iconRes: Int, selected: Boolean, parent: ViewGroup?, onClick: (() -> Unit)? = null): LinearLayout =
        pill(title, iconRes, if (selected) Color.WHITE else DoctorTheme.wine, DoctorTheme.rose, DFont.SUBHEAD_SEMI, parent, 14, 9, gradientBg = selected).apply {
            if (onClick != null) { isClickable = true; isFocusable = true; setOnClickListener { onClick() } }
        }
    fun headerPill(value: String, iconRes: Int, parent: ViewGroup?) =
        pill(value, iconRes, Color.WHITE, DoctorTheme.alpha(Color.WHITE, 0.16f), DFont.CAPTION_SEMI, parent, 12, 7, stroke = DoctorTheme.alpha(Color.WHITE, 0.25f))
    fun statusPill(value: String, iconRes: Int, positive: Boolean, parent: ViewGroup?) =
        pill(value, iconRes, if (positive) DoctorTheme.greenInk else DoctorTheme.warnInk, if (positive) DoctorTheme.green else DoctorTheme.warnFill, DFont.CAPTION2_BOLD, parent)
    /** HospitalBadge */
    fun badge(value: String, warning: Boolean = false, parent: ViewGroup?) = text(value, DFont(10f, 1), DoctorTheme.ink, parent).apply {
        background = capsule(if (warning) DoctorTheme.warnFill else DoctorTheme.green); setPadding(dp(10), dp(5), dp(10), dp(5))
        minWidth = dp(100)
    }

    // ---------- Encabezado de bloque ----------
    fun blockHeader(parent: ViewGroup?, iconRes: Int, title: String, subtitle: String, letter: String? = null): LinearLayout =
        hbox(12, parent).apply {
            val holder = FrameLayout(context).apply { layoutParams = LinearLayout.LayoutParams(dp(50), dp(50)) }
            val square = ImageView(context).apply {
                setImageResource(iconRes); imageTintList = ColorStateList.valueOf(Color.WHITE)
                background = gradient(13); setPadding(dp(11), dp(11), dp(11), dp(11))
                layoutParams = FrameLayout.LayoutParams(dp(44), dp(44))
            }
            holder.addView(square)
            if (letter != null) {
                holder.addView(TextView(context).apply {
                    text = letter; setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f); typeface = face(3); setTextColor(DoctorTheme.wine)
                    gravity = Gravity.CENTER; includeFontPadding = false
                    background = oval(Color.WHITE, DoctorTheme.rose, 2)
                    layoutParams = FrameLayout.LayoutParams(dp(20), dp(20), Gravity.BOTTOM or Gravity.END)
                })
            }
            addView(holder)
            val texts = vbox(2, this).apply { layoutParams = LinearLayout.LayoutParams(0, -2, 1f) }
            text(if (letter != null) "$letter. $title" else title, DFont.HEADLINE, DoctorTheme.ink, texts)
            text(subtitle, DFont.CAPTION, DoctorTheme.secondary, texts)
        }

    // ---------- Botones ----------
    /** Botón principal con degradado vino (o gris secondary si está deshabilitado), radio 16. */
    fun primaryButton(title: String, iconRes: Int?, parent: ViewGroup?, enabled: Boolean = true, height: Int = 54, radius: Int = 16,
                      onClick: () -> Unit): LinearLayout = hbox(8, parent).apply {
        gravity = Gravity.CENTER; minimumHeight = dp(height)
        background = if (enabled) gradient(radius) else rounded(DoctorTheme.secondary, radius)
        setPadding(dp(16), dp(10), dp(16), dp(10))
        if (iconRes != null) icon(iconRes, Color.WHITE, 18, this)
        text(title, DFont.HEADLINE, Color.WHITE, this, center = false).gravity = Gravity.CENTER
        isClickable = enabled; isFocusable = enabled; isEnabled = enabled; contentDescription = title
        setOnClickListener { if (isEnabled) onClick() }
    }
    /** HospitalPrimaryButtonStyle: vino sólido radio 14, 15sp semibold. */
    fun solidButton(title: String, parent: ViewGroup?, enabled: Boolean = true, iconRes: Int? = null, onClick: () -> Unit) = hbox(8, parent).apply {
        gravity = Gravity.CENTER; background = rounded(DoctorTheme.wine, 14); setPadding(dp(16), dp(15), dp(16), dp(15))
        if (iconRes != null) icon(iconRes, Color.WHITE, 17, this)
        text(title, DFont(15f, 1), Color.WHITE, this)
        alpha = if (enabled) 1f else 0.45f; isEnabled = enabled; isClickable = enabled
        setOnClickListener { if (isEnabled) onClick() }
    }
    /** `.buttonStyle(.bordered).tint(wine)`: relleno vino translúcido, texto vino. */
    fun borderedButton(title: String, iconRes: Int?, parent: ViewGroup?, enabled: Boolean = true, height: Int = 46, font: DFont = DFont.SUBHEAD_SEMI,
                       onClick: () -> Unit): LinearLayout = hbox(8, parent).apply {
        gravity = Gravity.CENTER; minimumHeight = dp(height)
        background = rounded(DoctorTheme.alpha(DoctorTheme.wine, 0.12f), 12)
        setPadding(dp(14), dp(8), dp(14), dp(8))
        if (iconRes != null) icon(iconRes, DoctorTheme.wine, 17, this)
        text(title, font, DoctorTheme.wine, this)
        alpha = if (enabled) 1f else 0.4f; isEnabled = enabled; isClickable = enabled; isFocusable = enabled
        setOnClickListener { if (isEnabled) onClick() }
    }
    /** Botón de texto plano (Button por defecto de iOS con tint vino). */
    fun linkButton(title: String, iconRes: Int? = null, parent: ViewGroup?, font: DFont = DFont.BODY, color: Int = DoctorTheme.wine,
                   enabled: Boolean = true, onClick: () -> Unit): LinearLayout = hbox(6, parent).apply {
        layoutParams = LinearLayout.LayoutParams(-2, -2); minimumHeight = dp(36)
        if (iconRes != null) icon(iconRes, color, (font.size).toInt(), this)
        text(title, font, color, this)
        alpha = if (enabled) 1f else 0.4f; isEnabled = enabled; isClickable = enabled; isFocusable = enabled
        background = rippleless()
        setOnClickListener { if (isEnabled) onClick() }
    }
    private fun rippleless(): android.graphics.drawable.Drawable? {
        val value = TypedValue(); context.theme.resolveAttribute(android.R.attr.selectableItemBackground, value, true)
        return androidx.core.content.ContextCompat.getDrawable(context, value.resourceId)
    }
    fun circleIconButton(iconRes: Int, description: String, parent: ViewGroup?, size: Int = 36, fill: Int = DoctorTheme.rose, tint: Int = DoctorTheme.wine,
                         onClick: () -> Unit) = icon(iconRes, tint, size / 2, parent, size, oval(fill)).apply {
        contentDescription = description; isClickable = true; isFocusable = true; setOnClickListener { onClick() }
    }
    fun clickable(view: View, onClick: () -> Unit): View {
        view.isClickable = true; view.isFocusable = true; view.foreground = rippleless(); view.setOnClickListener { onClick() }; return view
    }

    // ---------- Campos ----------
    fun edit(placeholder: String, value: String, multiline: Boolean = false, max: Int = 2000, numeric: Boolean = false, decimal: Boolean = false,
             phone: Boolean = false, password: Boolean = false, font: DFont = DFont.BODY, onChange: (String) -> Unit = {}): EditText =
        EditText(context).apply {
            hint = placeholder; setText(value); setTextSize(TypedValue.COMPLEX_UNIT_SP, font.size); typeface = face(font.weight)
            setTextColor(DoctorTheme.ink); setHintTextColor(DoctorTheme.alpha(DoctorTheme.secondary, 0.75f))
            background = null; setPadding(0, 0, 0, 0); includeFontPadding = false
            filters = arrayOf(InputFilter.LengthFilter(max)); isSaveEnabled = false
            inputType = when {
                password -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                decimal -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                numeric -> InputType.TYPE_CLASS_NUMBER
                phone -> InputType.TYPE_CLASS_PHONE
                multiline -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                else -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            }
            if (multiline) { gravity = Gravity.TOP or Gravity.START; isSingleLine = false } else isSingleLine = true
            contentDescription = placeholder
            layoutParams = LinearLayout.LayoutParams(-1, -2)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) { onChange(s?.toString().orEmpty()) }
            })
        }
    /** Campo con fondo gris claro (HospitalTheme.background) y radio 12. */
    fun field(parent: ViewGroup?, placeholder: String, value: String, multiline: Boolean = false, minLines: Int = 1, max: Int = 2000,
              numeric: Boolean = false, decimal: Boolean = false, phone: Boolean = false, password: Boolean = false, bg: Int = DoctorTheme.background,
              stroke: Int = 0, padding: Int = 14, radius: Int = 12, onChange: (String) -> Unit = {}): EditText {
        val input = edit(placeholder, value, multiline, max, numeric, decimal, phone, password, onChange = onChange)
        input.background = rounded(bg, radius, stroke, 1.5f); input.setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
        if (multiline) input.minLines = minLines
        parent?.addView(input)
        return input
    }
    /** Título semibold + campo (transportField / rxField). */
    fun labeledField(parent: ViewGroup?, title: String, placeholder: String, value: String, titleFont: DFont = DFont.SUBHEAD_SEMI,
                     titleColor: Int = DoctorTheme.ink, numeric: Boolean = false, decimal: Boolean = false, phone: Boolean = false, unit: String? = null,
                     max: Int = 1000, onChange: (String) -> Unit): EditText {
        val box = vbox(6, parent)
        text(title, titleFont, titleColor, box)
        return if (unit == null) field(box, placeholder, value, max = max, numeric = numeric, decimal = decimal, phone = phone, padding = 12, onChange = onChange)
        else {
            val row = hbox(6, box).apply { background = rounded(DoctorTheme.background, 12); setPadding(dp(12), dp(12), dp(12), dp(12)) }
            val input = edit(placeholder, value, max = max, numeric = numeric, decimal = decimal, onChange = onChange)
            input.layoutParams = LinearLayout.LayoutParams(0, -2, 1f); row.addView(input)
            text(unit, DFont.CAPTION_BOLD, DoctorTheme.wine, row); input
        }
    }
    /** Buscador: lupa vino + campo + botón borrar. */
    fun searchField(parent: ViewGroup?, placeholder: String, value: String, bg: Int = DoctorTheme.background, stroke: Int = 0, strokeWidth: Float = 1f,
                    height: Int = 48, radius: Int = 14, loading: Boolean = false, iconSize: Int = 17, onSubmit: (() -> Unit)? = null,
                    onChange: (String) -> Unit): EditText {
        val row = hbox(10, parent).apply {
            minimumHeight = dp(height); background = rounded(bg, radius, stroke, strokeWidth); setPadding(dp(14), dp(6), dp(14), dp(6))
        }
        icon(R.drawable.ic_d_search, DoctorTheme.wine, iconSize, row)
        lateinit var clear: View
        val input = edit(placeholder, value, max = 120) { clear.visibility = if (it.isEmpty() || loading) View.GONE else View.VISIBLE; onChange(it) }
        input.layoutParams = LinearLayout.LayoutParams(0, -2, 1f); row.addView(input)
        if (onSubmit != null) {
            input.imeOptions = EditorInfo.IME_ACTION_SEARCH
            input.setOnEditorActionListener { _, action, _ -> if (action == EditorInfo.IME_ACTION_SEARCH) { onSubmit(); true } else false }
        }
        if (loading) row.addView(ProgressBar(context).apply { layoutParams = LinearLayout.LayoutParams(dp(18), dp(18)); indeterminateTintList = ColorStateList.valueOf(DoctorTheme.secondary) })
        clear = icon(R.drawable.ic_d_clear, DoctorTheme.secondary, 18, row).apply {
            contentDescription = "Borrar búsqueda"; isClickable = true
            visibility = if (value.isEmpty() || loading) View.GONE else View.VISIBLE
            setOnClickListener { input.setText("") }
        }
        return input
    }

    /** Picker(.segmented) de iOS. */
    fun segmented(parent: ViewGroup?, options: List<Pair<String, String>>, selected: String, onChange: (String) -> Unit): LinearLayout {
        val track = hbox(0, parent).apply { background = rounded(DoctorTheme.segmentTrack, 9); setPadding(dp(2), dp(2), dp(2), dp(2)) }
        val cells = mutableListOf<TextView>()
        fun paint(value: String) = cells.forEachIndexed { i, cell ->
            val on = options[i].first == value
            cell.background = if (on) rounded(Color.WHITE, 7) else null
            cell.elevation = if (on) dpf(1f) else 0f
            cell.typeface = face(if (on) 1 else 0)
        }
        options.forEach { (id, title) ->
            val cell = text(title, DFont(13f, 0), DoctorTheme.ink, track).apply {
                gravity = Gravity.CENTER; layoutParams = LinearLayout.LayoutParams(0, dp(30), 1f)
                isClickable = true; setOnClickListener { paint(id); onChange(id) }
            }
            cells.add(cell)
        }
        paint(selected)
        return track
    }

    // ---------- Avisos y estados ----------
    /** HospitalNotice: franja rosa con texto vino. */
    fun notice(value: String, parent: ViewGroup?) = text(value, DFont.FOOTNOTE, DoctorTheme.wine, parent).apply {
        layoutParams = LinearLayout.LayoutParams(-1, -2); background = rounded(DoctorTheme.rose, 12); setPadding(dp(12), dp(12), dp(12), dp(12))
    }
    fun emptyState(parent: ViewGroup?, iconRes: Int, title: String, body: String, big: Boolean = false) = vbox(if (big) 10 else 8, parent).apply {
        gravity = Gravity.CENTER_HORIZONTAL; background = rounded(Color.WHITE, if (big) 20 else 18)
        val pad = if (big) 24 else 20; setPadding(dp(pad), dp(pad), dp(pad), dp(pad))
        icon(iconRes, DoctorTheme.wine, if (big) 34 else 28, this, if (big) 70 else 58, oval(DoctorTheme.rose))
        text(title, if (big) DFont.HEADLINE else DFont.SUBHEAD_SEMI, DoctorTheme.ink, this, center = true)
        text(body, if (big) DFont.SUBHEAD else DFont.FOOTNOTE, DoctorTheme.secondary, this, center = true)
    }
    fun progress(parent: ViewGroup?, message: String = "") = vbox(8, parent).apply {
        gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, dp(6), 0, dp(6))
        addView(ProgressBar(context).apply { layoutParams = LinearLayout.LayoutParams(dp(28), dp(28)); indeterminateTintList = ColorStateList.valueOf(DoctorTheme.secondary) })
        if (message.isNotEmpty()) text(message, DFont.SUBHEAD, DoctorTheme.secondary, this, center = true)
    }
    fun smallSpinner(parent: ViewGroup?) = ProgressBar(context).apply {
        layoutParams = LinearLayout.LayoutParams(dp(18), dp(18)); indeterminateTintList = ColorStateList.valueOf(DoctorTheme.secondary); parent?.addView(this)
    }
    fun divider(parent: ViewGroup?, inset: Int = 0) = View(context).apply {
        setBackgroundColor(DoctorTheme.divider); parent?.addView(this, LinearLayout.LayoutParams(-1, dp(1).coerceAtLeast(1) / 2 + 1).apply { marginStart = dp(inset) })
    }
    /** DisclosureGroup: título vino con chevron que despliega el contenido. */
    fun disclosure(parent: ViewGroup?, title: String, font: DFont = DFont.SUBHEAD_SEMI, titleColor: Int = DoctorTheme.ink,
                   leading: ((LinearLayout) -> Unit)? = null, expanded: Boolean = false, build: (LinearLayout) -> Unit): LinearLayout {
        val box = vbox(0, parent)
        val row = hbox(8, box).apply { minimumHeight = dp(36) }
        if (leading != null) leading(row) else text(title, font, titleColor, row).layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        if (leading != null) spacerView(row)
        val chevron = icon(R.drawable.ic_d_chevron_right, DoctorTheme.wine, 18, row)
        val body = vbox(0, box).apply { visibility = View.GONE; setPadding(0, dp(10), 0, 0) }
        var built = false
        fun set(open: Boolean) {
            if (open && !built) { build(body); built = true }
            body.visibility = if (open) View.VISIBLE else View.GONE
            chevron.rotation = if (open) 90f else 0f
        }
        clickable(row) { set(body.visibility != View.VISIBLE) }
        row.contentDescription = title
        set(expanded)
        return box
    }
    fun circleText(value: String, size: Int, fg: Int, bg: Int, font: DFont, parent: ViewGroup?, ring: Boolean = false) = TextView(context).apply {
        text = value; setTextSize(TypedValue.COMPLEX_UNIT_SP, font.size); typeface = face(font.weight); setTextColor(fg)
        gravity = Gravity.CENTER; includeFontPadding = false
        background = if (ring) android.graphics.drawable.LayerDrawable(arrayOf(oval(DoctorTheme.alpha(Color.WHITE, 0.35f)), oval(bg))).apply { setLayerInset(1, dp(4), dp(4), dp(4), dp(4)) } else oval(bg)
        val total = if (ring) size + 8 else size
        layoutParams = LinearLayout.LayoutParams(dp(total), dp(total)); parent?.addView(this)
    }
    fun horizontalChips(parent: ViewGroup?, spacing: Int = 8): LinearLayout {
        val scroll = HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false; layoutParams = LinearLayout.LayoutParams(-1, -2) }
        parent?.addView(scroll)
        return hbox(spacing).also { it.layoutParams = ViewGroup.LayoutParams(-2, -2); it.setPadding(0, dp(2), 0, dp(2)); scroll.addView(it) }
    }
    /** Cuadrícula adaptable de 2 columnas (LazyVGrid adaptive en un teléfono). */
    fun grid(parent: ViewGroup?, items: List<(LinearLayout) -> Any?>, columns: Int = 2, spacing: Int = 10) {
        val box = vbox(spacing, parent)
        items.chunked(columns).forEach { chunk ->
            val row = hbox(spacing, box, center = false)
            chunk.forEach { make ->
                val cell = vbox(0, row).apply { layoutParams = LinearLayout.LayoutParams(0, -1, 1f) }
                make(cell)
                cell.getChildAt(0)?.layoutParams = LinearLayout.LayoutParams(-1, -1)
            }
            repeat(columns - chunk.size) { vbox(0, row).layoutParams = LinearLayout.LayoutParams(0, 1, 1f) }
        }
    }
}

/** Fila con salto automático (ConsultationFlowLayout). */
class DoctorFlowLayout(context: Context, private val spacing: Int) : ViewGroup(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec).let { if (it == 0) Int.MAX_VALUE else it } - paddingLeft - paddingRight
        var x = 0; var y = 0; var rowHeight = 0; var maxX = 0
        for (i in 0 until childCount) {
            val child = getChildAt(i); if (child.visibility == GONE) continue
            child.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
            if (x > 0 && x + child.measuredWidth > width) { y += rowHeight + spacing; x = 0; rowHeight = 0 }
            x += child.measuredWidth + spacing; rowHeight = maxOf(rowHeight, child.measuredHeight); maxX = maxOf(maxX, x)
        }
        val total = y + rowHeight + paddingTop + paddingBottom
        setMeasuredDimension(resolveSize(maxX + paddingLeft + paddingRight, widthMeasureSpec), resolveSize(total, heightMeasureSpec))
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val width = r - l - paddingLeft - paddingRight
        var x = 0; var y = 0; var rowHeight = 0
        for (i in 0 until childCount) {
            val child = getChildAt(i); if (child.visibility == GONE) continue
            if (x > 0 && x + child.measuredWidth > width) { y += rowHeight + spacing; x = 0; rowHeight = 0 }
            child.layout(paddingLeft + x, paddingTop + y, paddingLeft + x + child.measuredWidth, paddingTop + y + child.measuredHeight)
            x += child.measuredWidth + spacing; rowHeight = maxOf(rowHeight, child.measuredHeight)
        }
    }
}
