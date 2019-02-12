import React, { Fragment, ReactElement } from "react";
import * as shortid from "shortid";
import { CanvasTools } from "vott-ct";
import { Editor } from "vott-ct/lib/js/CanvasTools/CanvasTools.Editor";
import { RegionData } from "vott-ct/lib/js/CanvasTools/Core/RegionData";
import { SelectionMode } from "vott-ct/lib/js/CanvasTools/Selection/AreaSelector";
import { ClipBoard } from "../../../../common/clipboard";
import { AssetState, EditorMode, IAssetMetadata, IProject,
    IRegion, ITag, RegionType } from "../../../../models/applicationState";
import { AssetPreview, ContentSource } from "../../common/assetPreview/assetPreview";
import { KeyboardBinding } from "../../common/keyboardBinding/keyboardBinding";
import { KeyEventType } from "../../common/keyboardManager/keyboardManager";
import CanvasHelpers from "./canvasHelpers";

export interface ICanvasProps extends React.Props<Canvas> {
    selectedAsset: IAssetMetadata;
    editorMode: EditorMode;
    selectionMode: SelectionMode;
    project: IProject;
    selectedTags: ITag[];
    children?: ReactElement<AssetPreview>;
    onAssetMetadataChanged?: (assetMetadata: IAssetMetadata) => void;
}

export interface ICanvasState {
    contentSource: ContentSource;
    selectedRegions?: IRegion[];
    canvasEnabled: boolean;
    multiSelect: boolean;
}

export default class Canvas extends React.Component<ICanvasProps, ICanvasState> {

    public editor: Editor;

    public state: ICanvasState = {
        contentSource: null,
        selectedRegions: [],
        canvasEnabled: true,
        multiSelect: false,
    };

    private clipBoard: ClipBoard<IRegion[]> = new ClipBoard<IRegion[]>();

    private canvasZone: React.RefObject<HTMLDivElement> = React.createRef();

    public componentDidMount = () => {
        const sz = document.getElementById("editor-zone") as HTMLDivElement;
        this.editor = new CanvasTools.Editor(sz);
        this.editor.onSelectionEnd = this.onSelectionEnd;
        this.editor.onRegionMove = this.onRegionMove;
        this.editor.onRegionDelete = this.onRegionDelete;
        this.editor.onRegionSelected = this.onRegionSelected;
        this.editor.setSelectionMode(this.props.selectionMode, null);

        window.addEventListener("resize", this.onWindowResize);

        this.clearAllRegions();
    }

    public componentWillUnmount() {
        window.removeEventListener("resize", this.onWindowResize);
    }

    public componentDidUpdate = (prevProps: Readonly<ICanvasProps>) => {
        if (this.props.selectedAsset.asset.id !== prevProps.selectedAsset.asset.id) {
            this.clearAllRegions();
            if (this.props.selectedAsset.regions.length) {
                this.setState({
                    selectedRegions: [],
                });
            }
        }

        if (this.props.selectionMode !== prevProps.selectionMode) {
            this.editor.setSelectionMode(this.props.selectionMode, null);
        }

        if(this.props.selectedTags !== prevProps.selectedTags) {
            this.applyTags();
        }
    }

    public render = () => {
        return (

            <Fragment>
                <KeyboardBinding
                    keyEventType={KeyEventType.KeyDown}
                    accelerator={"Shift"}
                    onKeyEvent={() => this.setMultiSelect(true)}
                />
                <KeyboardBinding
                    keyEventType={KeyEventType.KeyUp}
                    accelerator={"Shift"}
                    onKeyEvent={() => this.setMultiSelect(false)}
                />
                <KeyboardBinding
                    keyEventType={KeyEventType.KeyDown}
                    accelerator={"Ctrl+c"}
                    onKeyEvent={this.copyRegions}
                />
                <KeyboardBinding
                    keyEventType={KeyEventType.KeyDown}
                    accelerator={"Ctrl+x"}
                    onKeyEvent={this.cutRegions}
                />
                <KeyboardBinding
                    keyEventType={KeyEventType.KeyDown}
                    accelerator={"Ctrl+v"}
                    onKeyEvent={this.pasteRegions}
                />
                <KeyboardBinding
                    keyEventType={KeyEventType.KeyDown}
                    accelerator={"Ctrl+a"}
                    onKeyEvent={this.selectAllRegions}
                />
                <KeyboardBinding
                    keyEventType={KeyEventType.KeyDown}
                    accelerator={"Ctrl+d"}
                    onKeyEvent={this.clearRegions}
                />
                <div id="ct-zone"
                    ref={this.canvasZone}
                    className={this.state.canvasEnabled ? "canvas-enabled" : "canvas-disabled"}>
                    <div id="selection-zone">
                        <div id="editor-zone" className="full-size" />
                    </div>
                </div>
                {this.renderChildren()}
            </Fragment>
        );
    }

    private applyTags = () => {
        for (const region of this.state.selectedRegions) {
            if (!this.props.selectedTags || !this.props.selectedTags.length) {
                region.tags = [];
            } else {
                for (const tag of this.props.selectedTags) {
                    region.tags = CanvasHelpers.toggleTag(region.tags, tag);
                }
            }
            this.editor.RM.updateTagsById(region.id, CanvasHelpers.getTagsDescriptor(region));
        }
        this.props.onAssetMetadataChanged(this.props.selectedAsset);
    }

    /**
     * Method called when selecting a region from the editor
     * @param {string} id the id of the deleted region
     * @returns {void}
     */
    public onRegionSelected = (id: string) => {

        const selectedRegion = this.props.selectedAsset.regions.find((region) => region.id === id);

        let selectedRegions = this.state.selectedRegions;

        if (this.state.multiSelect) {
            if (!selectedRegions.find((r) => r.id === selectedRegion.id)) {
                selectedRegions.push(selectedRegion);
            }
        } else {
            selectedRegions = [selectedRegion];
        }
        this.setState({ selectedRegions });
    }

    /**
     * Method that gets called when a new region is drawn
     * @param {RegionData} commit the RegionData of created region
     * @returns {void}
     */
    private onSelectionEnd = (commit: RegionData) => {
        const id = shortid.generate();

        this.editor.RM.addRegion(id, commit, null);

        // RegionData not serializable so need to extract data
        const scaledRegionData = this.editor.scaleRegionToSourceSize(commit);
        const newRegion = CanvasHelpers.getRegion(scaledRegionData, this.props.editorMode, id);
        const currentAssetMetadata = this.props.selectedAsset;
        currentAssetMetadata.regions.push(newRegion);
        this.setState({
            selectedRegions: [newRegion],
        }, () => this.applyTags());

        if (currentAssetMetadata.regions.length) {
            currentAssetMetadata.asset.state = AssetState.Tagged;
        }

        this.props.onAssetMetadataChanged(currentAssetMetadata);
    }

    /**
     * Method called when moving a region already in the editor
     * @param {string} id the id of the region that was moved
     * @param {RegionData} regionData the RegionData of moved region
     * @returns {void}
     */
    private onRegionMove = (id: string, regionData: RegionData) => {
        const currentAssetMetadata = this.props.selectedAsset;
        const movedRegionIndex = currentAssetMetadata.regions.findIndex((region) => region.id === id);
        const movedRegion = currentAssetMetadata.regions[movedRegionIndex];
        const scaledRegionData = this.editor.scaleRegionToSourceSize(regionData);

        if (movedRegion) {
            movedRegion.points = scaledRegionData.points;
        }

        currentAssetMetadata.regions[movedRegionIndex] = movedRegion;
        this.setState({
            selectedRegions: [ movedRegion ],
        });
        this.props.onAssetMetadataChanged(currentAssetMetadata);
    }

    /**
     * Method called when deleting a region from the editor
     * @param {string} id the id of the deleted region
     * @returns {void}
     */
    private onRegionDelete = (id: string) => {
        // Remove from Canvas Tools
        this.editor.RM.deleteRegionById(id);
        const currentAssetMetadata = this.deleteRegionFromAsset(id);

        this.props.onAssetMetadataChanged(currentAssetMetadata);
        this.setState({
            selectedRegions: [],
        });
    }

    private setMultiSelect = (multiSelect: boolean) => {
        if (multiSelect !== this.state.multiSelect) {
            this.setState({ multiSelect });
        }
    }

    private copyRegions = () => {
        if (this.state.selectedRegions) {
            this.clipBoard.set(this.state.selectedRegions);
        }
    }

    private cutRegions = () => {
        this.copyRegions();
        for (const region of this.state.selectedRegions) {
            this.onRegionDelete(region.id);
        }
    }

    private pasteRegions = () => {
        const regions = this.clipBoard.get();
        if (regions) {
            const newRegions = CanvasHelpers.duplicateAndTransformRegions(regions, this.props.selectedAsset.regions);
            this.addRegions(newRegions);
        }
    }

    private clearRegions = () => {
        const ids = this.props.selectedAsset.regions.map((r) => r.id);
        for (const id of ids) {
            this.onRegionDelete(id);
        }
    }

    private addRegionToAsset = (region: IRegion): IAssetMetadata => {
        const currentAssetMetadata = this.props.selectedAsset;
        currentAssetMetadata.regions.push(region);

        if (currentAssetMetadata.regions.length) {
            currentAssetMetadata.asset.state = AssetState.Tagged;
        }

        return currentAssetMetadata;
    }

    private deleteRegionFromAsset = (id: string): IAssetMetadata => {
        // Remove from project
        const currentAssetMetadata = this.props.selectedAsset;
        const deletedRegionIndex = this.props.selectedAsset.regions.findIndex((region) => region.id === id);
        currentAssetMetadata.regions.splice(deletedRegionIndex, 1);

        if (!currentAssetMetadata.regions.length) {
            currentAssetMetadata.asset.state = AssetState.Visited;
        }
        return currentAssetMetadata;
    }

    private addRegions = (regions: IRegion[]) => {
        let currentAssetMetadata: IAssetMetadata;
        for (const region of regions) {
            const regionData = CanvasHelpers.getRegionData(region);
            const scaledRegionData = this.editor.scaleRegionToFrameSize(regionData);
            this.editor.RM.addRegion(
                region.id,
                scaledRegionData,
                CanvasHelpers.getTagsDescriptor(region));
            currentAssetMetadata = this.addRegionToAsset(region);
        }
        this.props.onAssetMetadataChanged(currentAssetMetadata);
    }

    private renderChildren = () => {
        return React.cloneElement(this.props.children, {
            onLoaded: this.onAssetLoaded,
            onActivated: this.onAssetActivated,
            onDeactivated: this.onAssetDeactivated,
        });
    }

    /**
     * Raised when the underlying asset has completed loading
     */
    private onAssetLoaded = async (contentSource: ContentSource) => {
        this.positionCanvas(contentSource);
        await this.setContentSource(contentSource);
        this.updateRegions();
    }

    /**
     * Raised when the asset is taking control over the rendering
     */
    private onAssetActivated = (contentSource: ContentSource) => {
        this.clearAllRegions();
        this.setState({
            canvasEnabled: false,
        });
    }

    /**
     * Raise when the asset is handing off control of rendering
     */
    private onAssetDeactivated = async (contentSource: ContentSource) => {
        this.positionCanvas(contentSource);
        await this.setContentSource(contentSource);
        this.updateRegions();

        this.setState({
            canvasEnabled: true,
        });
    }

    /**
     * Set the loaded asset content source into the canvas tools canvas
     */
    private setContentSource = async (contentSource: ContentSource) => {
        this.setState({ contentSource });
        try {
            await this.editor.addContentSource(contentSource);
        } catch (e) {
            console.warn(e);
        }
    }

    /**
     * Positions the canvas tools drawing surface to be exactly over the asset content
     */
    private positionCanvas = (contentSource: ContentSource) => {
        const canvas = this.canvasZone.current;
        canvas.style.top = `${contentSource.offsetTop}px`;
        canvas.style.left = `${contentSource.offsetLeft}px`;
        canvas.style.width = `${contentSource.offsetWidth}px`;
        canvas.style.height = `${contentSource.offsetHeight}px`;
    }

    private onWindowResize = () => {
        this.positionCanvas(this.state.contentSource);
    }

    /**
     * Updates the background of the canvas and draws the asset's regions
     */
    private clearAllRegions = () => {
        this.editor.RM.deleteAllRegions();
    }

    private updateRegions = () => {
        if (!this.props.selectedAsset.regions || this.props.selectedAsset.regions.length === 0) {
            return;
        }

        // Add regions to the canvas
        this.props.selectedAsset.regions.forEach((region: IRegion) => {
            const loadedRegionData = CanvasHelpers.getRegionData(region);
            this.editor.RM.addRegion(
                region.id,
                this.editor.scaleRegionToFrameSize(loadedRegionData),
                CanvasHelpers.getTagsDescriptor(region));
        });

        // Set selected region to the last region
        this.setState({
            selectedRegions: [this.props.selectedAsset.regions[this.props.selectedAsset.regions.length - 1]],
        });
    }

    private selectAllRegions = () => {
        this.setState({ selectedRegions: this.props.selectedAsset.regions }, () => this.applyTags());
    }

}
