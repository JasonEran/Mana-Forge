using System.Diagnostics;
using System.Drawing.Drawing2D;

namespace Mana.NativeLauncher;

internal enum AvatarState
{
    Idle,
    Talking,
}

internal sealed class AvatarOverlayForm : Form
{
    private const int BarCount = 32;
    private static readonly Color IdleColor = Color.FromArgb(247, 250, 252);
    private static readonly Color ActiveColor = Color.FromArgb(167, 243, 208);

    private readonly System.Windows.Forms.Timer animationTimer = new() { Interval = 33 };
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly float[] phases = new float[BarCount];
    private readonly float[] driftSpeeds = new float[BarCount];
    private readonly float[] lengthBiases = new float[BarCount];
    private AvatarState state;

    public AvatarOverlayForm(string rootDirectory)
    {
        _ = rootDirectory;
        var random = new Random(0x4d414e41);
        for (var index = 0; index < BarCount; index += 1)
        {
            phases[index] = (float)(random.NextDouble() * Math.PI * 2);
            driftSpeeds[index] = 0.17f + (float)random.NextDouble() * 0.19f;
            lengthBiases[index] = 0.36f + (float)random.NextDouble() * 0.24f;
        }

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        Width = ReadIntEnv("MANA_AVATAR_WIDTH", 234);
        Height = ReadIntEnv("MANA_AVATAR_HEIGHT", 288);
        BackColor = Color.Magenta;
        TransparencyKey = Color.Magenta;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;

        animationTimer.Tick += (_, _) => Invalidate();
        animationTimer.Start();
        PositionOverlay();
    }

    public void SetState(AvatarState nextState)
    {
        state = nextState;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs eventArgs)
    {
        base.OnPaint(eventArgs);
        var graphics = eventArgs.Graphics;
        graphics.Clear(TransparencyKey);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;

        var seconds = (float)clock.Elapsed.TotalSeconds;
        var size = Math.Min(ClientSize.Width, ClientSize.Height);
        var centerX = ClientSize.Width / 2f;
        var centerY = ClientSize.Height / 2f;
        var innerRadius = size * 0.225f;
        var minimumLength = size * 0.055f;
        var lengthRange = size * 0.13f;
        var barWidth = Math.Max(2f, size * 0.014f);
        var active = state == AvatarState.Talking;
        var color = active ? ActiveColor : IdleColor;
        var rotation = seconds * (active ? 0.18f : 0.055f);
        var breath = MathF.Sin(seconds * 0.82f) * 0.045f;

        if (active)
        {
            var pulse = seconds % 1.25f / 1.25f;
            var pulseRadius = innerRadius * (0.72f + pulse * 0.38f);
            using var pulsePen = new Pen(Color.FromArgb((int)(58 * (1 - pulse)), ActiveColor), Math.Max(1f, size * 0.006f));
            graphics.DrawEllipse(pulsePen, centerX - pulseRadius, centerY - pulseRadius, pulseRadius * 2, pulseRadius * 2);
        }

        using var brush = new SolidBrush(color);
        for (var index = 0; index < BarCount; index += 1)
        {
            var angle = index / (float)BarCount * MathF.PI * 2;
            var slowNoise = MathF.Sin(seconds * driftSpeeds[index] + phases[index]);
            var secondaryNoise = MathF.Sin(seconds * driftSpeeds[index] * 0.43f + phases[index] * 1.71f);
            var irregular = slowNoise * 0.68f + secondaryNoise * 0.32f;
            var wave = active
                ? MathF.Pow(0.5f + 0.5f * MathF.Cos(angle - seconds * 2.2f + phases[index] * 0.08f), 2.1f)
                : 0;
            var factor = Math.Clamp(lengthBiases[index] + irregular * 0.13f + breath + wave * 0.34f, 0.2f, 1f);
            var length = minimumLength + lengthRange * factor;

            var savedState = graphics.Save();
            graphics.TranslateTransform(centerX, centerY);
            graphics.RotateTransform((angle + rotation) * 180f / MathF.PI);
            graphics.FillRectangle(brush, -barWidth / 2, -innerRadius - length, barWidth, length);
            graphics.Restore(savedState);
        }

        using var centerBrush = new SolidBrush(Color.FromArgb(active ? 200 : 72, color));
        var centerRadius = size * 0.018f;
        graphics.FillEllipse(centerBrush, centerX - centerRadius, centerY - centerRadius, centerRadius * 2, centerRadius * 2);
    }

    protected override CreateParams CreateParams
    {
        get
        {
            const int wsExTransparent = 0x20;
            const int wsExToolWindow = 0x80;
            const int wsExNoActivate = 0x08000000;
            var parameters = base.CreateParams;
            parameters.ExStyle |= wsExTransparent | wsExToolWindow | wsExNoActivate;
            return parameters;
        }
    }

    protected override bool ShowWithoutActivation => true;

    protected override void Dispose(bool disposing)
    {
        if (disposing) animationTimer.Dispose();
        base.Dispose(disposing);
    }

    private void PositionOverlay()
    {
        var workArea = Screen.PrimaryScreen?.WorkingArea ?? Screen.FromControl(this).WorkingArea;
        var left = ReadIntEnv("MANA_AVATAR_LEFT", 782);
        var bottom = ReadIntEnv("MANA_AVATAR_BOTTOM", 0);
        Left = workArea.Left + left;
        Top = workArea.Bottom - Height - bottom;
    }

    private static int ReadIntEnv(string name, int fallback)
    {
        return int.TryParse(Environment.GetEnvironmentVariable(name), out var value)
            ? value
            : fallback;
    }
}
