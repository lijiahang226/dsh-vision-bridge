using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Native capture helper for dsh-vision-bridge.
// Compiled by scripts/build.sh with csc.exe when available.
// This is the foundation for a faster, more reliable Windows capture path;
// it can later be extended with Windows.Graphics.Capture.
public class CaptureHelper
{
    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    static string Stats(string file, Bitmap bmp)
    {
        int nonWhite = 0;
        int nonBlack = 0;
        int total = 0;
        var seen = new System.Collections.Generic.HashSet<int>();
        for (int y = 0; y < bmp.Height; y += 2)
        {
            for (int x = 0; x < bmp.Width; x += 2)
            {
                Color c = bmp.GetPixel(x, y);
                seen.Add(c.ToArgb());
                if (c.R < 250 || c.G < 250 || c.B < 250) nonWhite++;
                if (c.R > 5 || c.G > 5 || c.B > 5) nonBlack++;
                total++;
            }
        }
        double nonWhiteRatio = total > 0 ? (double)nonWhite / total : 0;
        double nonBlackRatio = total > 0 ? (double)nonBlack / total : 0;
        bool blank = seen.Count <= 1 || nonWhiteRatio < 0.001 || nonBlackRatio < 0.001;
        return "{\"file\":\"" + file.Replace("\\", "\\\\") + "\",\"width\":" + bmp.Width +
            ",\"height\":" + bmp.Height + ",\"uniqueColors\":" + seen.Count +
            ",\"nonWhiteRatio\":" + nonWhiteRatio.ToString("0.0000") +
            ",\"nonBlackRatio\":" + nonBlackRatio.ToString("0.0000") +
            ",\"blank\":" + (blank ? "true" : "false") + "}";
    }

    static void CaptureScreen(int monitor, string file)
    {
        SetProcessDPIAware();
        Screen[] screens = Screen.AllScreens;
        Screen screen = (monitor >= 0 && monitor < screens.Length) ? screens[monitor] : Screen.PrimaryScreen;
        Rectangle bounds = screen.Bounds;
        using (Bitmap bmp = new Bitmap(bounds.Width, bounds.Height))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
            }
            bmp.Save(file, ImageFormat.Png);
            Console.WriteLine(Stats(file, bmp));
        }
    }

    static void CaptureWindow(IntPtr hwnd, string file, bool bringToFront, int rx, int ry, int rw, int rh)
    {
        SetProcessDPIAware();
        RECT rect;
        GetWindowRect(hwnd, out rect);
        Rectangle winRect = new Rectangle(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
        Screen screen = Screen.FromHandle(hwnd);
        Rectangle clip = Rectangle.Intersect(winRect, screen.Bounds);
        if (clip.IsEmpty) throw new Exception("Window is not visible on any screen");
        Rectangle capRect = clip;
        if (rw > 0 && rh > 0)
        {
            capRect = new Rectangle(winRect.Left + rx, winRect.Top + ry, rw, rh);
            capRect = Rectangle.Intersect(capRect, screen.Bounds);
            if (capRect.IsEmpty) throw new Exception("Region is not visible on screen");
        }
        if (bringToFront)
        {
            ShowWindow(hwnd, 9);
            SetForegroundWindow(hwnd);
            System.Threading.Thread.Sleep(400);
        }
        using (Bitmap bmp = new Bitmap(capRect.Width, capRect.Height))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(capRect.Left, capRect.Top, 0, 0, capRect.Size);
            }
            bmp.Save(file, ImageFormat.Png);
            Console.WriteLine(Stats(file, bmp));
        }
    }

    static IntPtr FindWindowByTitle(string title)
    {
        foreach (Process p in Process.GetProcesses())
        {
            if (p.MainWindowHandle != IntPtr.Zero && p.MainWindowTitle.IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return p.MainWindowHandle;
            }
        }
        return IntPtr.Zero;
    }

    static int Main(string[] args)
    {
        try
        {
            if (args.Length < 3)
            {
                Console.Error.WriteLine("usage: CaptureHelper screen <monitor> <file> | window <hwnd> <file> [bringToFront] [x y w h]");
                return 2;
            }
            string mode = args[0];
            if (mode == "screen")
            {
                int monitor = int.Parse(args[1]);
                CaptureScreen(monitor, args[2]);
            }
            else if (mode == "window")
            {
                IntPtr hwnd = new IntPtr(long.Parse(args[1]));
                string file = args[2];
                bool bring = args.Length > 3 && args[3] == "1";
                int rx = 0, ry = 0, rw = 0, rh = 0;
                if (args.Length > 7)
                {
                    rx = int.Parse(args[4]);
                    ry = int.Parse(args[5]);
                    rw = int.Parse(args[6]);
                    rh = int.Parse(args[7]);
                }
                CaptureWindow(hwnd, file, bring, rx, ry, rw, rh);
            }
            else if (mode == "window-title")
            {
                string title = args[1];
                string file = args[2];
                bool bring = args.Length > 3 && args[3] == "1";
                int rx = 0, ry = 0, rw = 0, rh = 0;
                if (args.Length > 7)
                {
                    rx = int.Parse(args[4]);
                    ry = int.Parse(args[5]);
                    rw = int.Parse(args[6]);
                    rh = int.Parse(args[7]);
                }
                IntPtr hwnd = FindWindowByTitle(title);
                if (hwnd == IntPtr.Zero) throw new Exception("Window not found: " + title);
                CaptureWindow(hwnd, file, bring, rx, ry, rw, rh);
            }
            else
            {
                return 2;
            }
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }
}
