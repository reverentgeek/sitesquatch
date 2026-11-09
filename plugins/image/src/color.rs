//! Converting images with an embedded color profile to sRGB.
//!
//! The encoders write plain sRGB pixels without a profile, which browsers
//! show as sRGB. A photo in a wider color space (Display P3 from an iPhone,
//! Adobe RGB from a camera) has to be converted first, or its colors come out
//! washed out. Images without a profile, or with an sRGB one, are left alone.
//! Only RGB profiles are converted; grayscale and CMYK profiles are ignored.
//!
//! Some RGB profiles can't be converted: the HDR photos newer iPhones take
//! carry a profile with a PQ tone curve and a gain-map lookup table, and
//! turning those into SDR sRGB needs tone mapping, not just a color
//! conversion. Those images are encoded as they are (as before conversion
//! existed), and the build warns about them.

use std::path::Path;

use anyhow::{anyhow, Result};
use image::{DynamicImage, ImageBuffer, ImageDecoder, ImageReader, Rgb, Rgba};
use moxcms::{ColorProfile, DataColorSpace, Layout, TransformOptions};

/// What to do with an image's embedded color profile.
pub(crate) enum Plan {
    /// No profile, an sRGB one, or one that isn't RGB: use the pixels as they are.
    Keep,
    /// Convert from this profile to sRGB. (Boxed: a profile is large.)
    Convert(Box<ColorProfile>),
    /// An RGB profile that can't be converted (why), so the pixels are used
    /// as they are and may look washed out.
    Unsupported(String),
}

impl Plan {
    pub(crate) fn for_icc(icc: Option<&[u8]>) -> Plan {
        let Some(icc) = icc else { return Plan::Keep };
        let Ok(profile) = ColorProfile::new_from_slice(icc) else { return Plan::Keep };
        if profile.color_space != DataColorSpace::Rgb || is_srgb(&profile) {
            return Plan::Keep;
        }
        // Building the transform is what fails for profiles moxcms can't handle.
        match profile.create_transform_8bit(Layout::Rgb, &ColorProfile::new_srgb(), Layout::Rgb, TransformOptions::default()) {
            Ok(_) => Plan::Convert(Box::new(profile)),
            Err(e) => Plan::Unsupported(format!("{:?}", e)),
        }
    }

    /// The plan for the file at `src`, read from its header without decoding
    /// the pixels.
    pub(crate) fn for_file(src: &Path) -> Plan {
        let icc = ImageReader::open(src).ok().and_then(|r| r.with_guessed_format().ok()).and_then(|r| r.into_decoder().ok()).and_then(|mut d| d.icc_profile().ok().flatten());
        Plan::for_icc(icc.as_deref())
    }

    pub(crate) fn converts(&self) -> bool {
        matches!(self, Plan::Convert(_))
    }
}

/// Whether `profile` has sRGB's primaries (an embedded "sRGB IEC61966-2.1",
/// say). Tone curves aren't compared: sRGB-primaries profiles in the wild use
/// the sRGB curve.
fn is_srgb(profile: &ColorProfile) -> bool {
    let srgb = ColorProfile::new_srgb();
    let close = |a: &moxcms::Xyzd, b: &moxcms::Xyzd| (a.x - b.x).abs() < 0.002 && (a.y - b.y).abs() < 0.002 && (a.z - b.z).abs() < 0.002;
    profile.is_matrix_shaper()
        && close(&profile.red_colorant, &srgb.red_colorant)
        && close(&profile.green_colorant, &srgb.green_colorant)
        && close(&profile.blue_colorant, &srgb.blue_colorant)
}

/// `img` converted from `profile` to sRGB, as 8-bit RGB (or RGBA, if it has
/// an alpha channel). The encoders all take 8-bit pixels anyway.
pub(crate) fn to_srgb(img: &DynamicImage, profile: &ColorProfile) -> Result<DynamicImage> {
    let srgb = ColorProfile::new_srgb();
    let fail = |e: moxcms::CmsError| anyhow!("converting colors to sRGB: {:?}", e);
    let (w, h) = (img.width(), img.height());
    if img.color().has_alpha() {
        let src = img.to_rgba8();
        let transform = profile.create_transform_8bit(Layout::Rgba, &srgb, Layout::Rgba, TransformOptions::default()).map_err(fail)?;
        let mut out = vec![0u8; src.len()];
        transform.transform(&src, &mut out).map_err(fail)?;
        let buf = ImageBuffer::<Rgba<u8>, _>::from_raw(w, h, out).ok_or_else(|| anyhow!("converting colors to sRGB: bad buffer size"))?;
        Ok(DynamicImage::ImageRgba8(buf))
    } else {
        let src = img.to_rgb8();
        let transform = profile.create_transform_8bit(Layout::Rgb, &srgb, Layout::Rgb, TransformOptions::default()).map_err(fail)?;
        let mut out = vec![0u8; src.len()];
        transform.transform(&src, &mut out).map_err(fail)?;
        let buf = ImageBuffer::<Rgb<u8>, _>::from_raw(w, h, out).ok_or_else(|| anyhow!("converting colors to sRGB: bad buffer size"))?;
        Ok(DynamicImage::ImageRgb8(buf))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn icc(profile: &ColorProfile) -> Vec<u8> {
        profile.encode().expect("encode profile")
    }

    fn plan(profile: &ColorProfile) -> Plan {
        Plan::for_icc(Some(&icc(profile)))
    }

    #[test]
    fn srgb_and_missing_profiles_are_left_alone() {
        assert!(matches!(plan(&ColorProfile::new_srgb()), Plan::Keep));
        assert!(matches!(Plan::for_icc(None), Plan::Keep));
        assert!(matches!(Plan::for_icc(Some(b"not a profile")), Plan::Keep));
    }

    #[test]
    fn display_p3_is_converted_to_srgb() {
        let Plan::Convert(p3) = plan(&ColorProfile::new_display_p3()) else { panic!("Display P3 is converted") };
        // Display P3's pure red is outside sRGB: it clips to full red. A P3
        // mid-gray stays gray (both use the same white point and curve).
        let img = DynamicImage::ImageRgb8(ImageBuffer::from_raw(2, 1, vec![255, 0, 0, 128, 128, 128]).unwrap());
        let out = to_srgb(&img, &p3).unwrap().to_rgb8();
        let red = out.get_pixel(0, 0).0;
        assert!(red[0] == 255 && red[1] < 10 && red[2] < 10, "{:?}", red);
        let gray = out.get_pixel(1, 0).0;
        assert!(gray.iter().all(|&c| c.abs_diff(128) <= 1), "{:?}", gray);

        // A less saturated P3 color moves in sRGB: the same numbers mean a
        // more saturated color in P3, so sRGB needs bigger differences.
        let img = DynamicImage::ImageRgb8(ImageBuffer::from_raw(1, 1, vec![200, 100, 80]).unwrap());
        let px = to_srgb(&img, &p3).unwrap().to_rgb8().get_pixel(0, 0).0;
        assert!(px[0] > 200 && px[1] < 100, "P3 (200, 100, 80) should get more saturated in sRGB: {:?}", px);
    }

    #[test]
    fn alpha_survives_conversion() {
        let Plan::Convert(p3) = plan(&ColorProfile::new_display_p3()) else { panic!("Display P3 is converted") };
        let img = DynamicImage::ImageRgba8(ImageBuffer::from_raw(1, 1, vec![10, 200, 30, 77]).unwrap());
        let out = to_srgb(&img, &p3).unwrap();
        assert!(out.color().has_alpha());
        assert_eq!(out.to_rgba8().get_pixel(0, 0).0[3], 77);
    }
}
